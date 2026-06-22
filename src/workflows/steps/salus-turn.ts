import { generateText, tool, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { sendWhatsapp } from "./uazapi";
import { createServiceClient, type Application } from "../../lib/supabase";
import { carolSystemPrompt } from "../prompts/ai-persona";
import { getFallbackPrompt, getFallbackModel, AI_DISABLED_STAGES } from "../prompts/stages/index";
import { getCarolConfig, getNotificationPhone } from "../../lib/crm-config";
import { getGoogleCalendarConfig, isSlotAvailable, createCalendarEvent } from "../../lib/google-calendar";

/**
 * Combina o carol_prompt global (persona/voz/conhecimento da marca) com o
 * prompt de stage (objetivo específico da etapa). O carol_prompt atua como
 * orquestrador: define identidade e regras globais; o stage prompt define
 * o foco e os critérios de promoção daquela etapa.
 *
 * {{LEAD_CONTEXT}} é removido do carol_prompt para não duplicar — o stage
 * prompt já o inclui no final, onde carolSystemPrompt faz a substituição.
 */
function buildCombinedPrompt(carolPrompt: string, stagePrompt: string): string {
  const base = carolPrompt.replace(/\{\{LEAD_CONTEXT\}\}/gi, "").trimEnd();
  const globalRules = `

⚠️ REGRAS GLOBAIS INVIOLÁVEIS (valem em TODOS os stages):
1. SEMPRE chame a tool "responder" para enviar mensagem ao lead. NUNCA gere texto sem chamar "responder".
2. Se for mudar o stage (mover_para_*), chame "responder" PRIMEIRO — o lead precisa receber uma resposta antes da transição.
3. Em cada turno você DEVE chamar "responder" pelo menos uma vez.
4. Se o lead fizer uma pergunta direta (nome, empresa, pedido de material, explicação), responda ESSA pergunta ANTES de qualquer outro assunto. NUNCA pule pergunta direta.
5. Se o lead perguntar seu nome → responda "Me chamo Sofia, sou assistente da Salus Water." — nunca ignore essa pergunta.
6. Se o lead pedir mais informações sobre a empresa ou quiser conhecer melhor a Salus → passe o site: https://watersalus.com/ — ex: "Você pode conhecer mais sobre a Salus em https://watersalus.com/ 😊"
7. FILOSOFIA — você NÃO vende: ajuda o lead a comprar. Compreenda antes de influenciar. Faça perguntas que levem o lead a articular a própria dor e chegar à própria conclusão. Nunca liste benefícios do produto sem ser perguntado. A decisão é sempre do lead — crie as condições para ele decidir, não tente convencê-lo.`;
  return `${base}${globalRules}\n\n---\n\n${stagePrompt}`;
}

/** Carrega system_prompt e ai_model do DB para o stage atual, combinando com o carol_prompt global */
async function getStageConfig(stage: string): Promise<{ prompt: string; model: string } | null> {
  if (AI_DISABLED_STAGES.has(stage)) return null;

  const supabase = createServiceClient();
  const [{ data }, carolCfg] = await Promise.all([
    supabase
      .from("kanban_stages")
      .select("system_prompt, ai_model, ai_enabled")
      .eq("id", stage)
      .maybeSingle(),
    getCarolConfig(),
  ]);

  // No DB row → use TS fallback if available (kanban_stages não configurado para este stage)
  if (!data) {
    const stagePrompt = getFallbackPrompt(stage);
    if (!stagePrompt) return null;
    return {
      prompt: buildCombinedPrompt(carolCfg.prompt, stagePrompt),
      model: getFallbackModel(stage),
    };
  }

  // DB row existe mas IA está explicitamente desabilitada para este stage
  if (!data.ai_enabled) return null;

  const stagePrompt = (data.system_prompt as string | null) || getFallbackPrompt(stage);
  if (!stagePrompt) return null;

  const prompt = buildCombinedPrompt(carolCfg.prompt, stagePrompt);
  const model = (data.ai_model as string | null) || getFallbackModel(stage);
  return { prompt, model };
}

/** Grava evento no log da IA (fire-and-forget) */
function logEvent(
  leadId: string,
  eventType: string,
  stage: string | null,
  details?: Record<string, unknown>,
) {
  createServiceClient()
    .from("ai_events")
    .insert({ lead_id: leadId, event_type: eventType, stage, details: details ?? null })
    .then(undefined, (err) => console.warn("ai_events insert failed", String(err)));
}

/**
 * Ordem do funil. Usado para bloquear retrocessos indevidos: o modelo às vezes
 * chama mover_para_respondeu estando em aquecendo, fazendo a etapa "piscar".
 * Etapas fora do mapa (contato_futuro, fechado, perdido, descartado) são
 * parques/terminais e nunca são bloqueadas.
 */
const STAGE_RANK: Record<string, number> = {
  lead_qualificado: 0, novo: 0,
  lead_contatado: 1, followup_1: 1,
  respondeu: 2, diagnostico: 2, contato_respondido_pela_ia: 2,
  aquecendo: 3, em_contato: 3,
  objecao: 3, negociacao: 3,
  agendado: 4, agendamento: 4, visita_tecnica: 4, ligacao_agendada: 4, call_agendada: 4,
  pos_visita: 5, proposta_enviada: 5,
};

/** Atualiza crm_stage no banco, pausa IA se necessário e loga a transição */
async function transitionStage(
  leadId: string,
  fromStage: string,
  nextStage: string,
  pauseAi = false,
) {
  // Guard anti-retrocesso: nunca voltar para uma etapa de qualificação inicial
  // (respondeu/lead_contatado) vinda de uma etapa posterior. Permite recuos
  // legítimos (ex: agendado → aquecendo quando o lead desiste de agendar).
  const fromRank = STAGE_RANK[fromStage];
  const toRank = STAGE_RANK[nextStage];
  if (fromRank !== undefined && toRank !== undefined && toRank < fromRank && toRank <= 2) {
    console.warn("transitionStage: retrocesso bloqueado", { leadId, fromStage, nextStage });
    logEvent(leadId, "stage_transition_blocked", fromStage, { attempted: nextStage, reason: "backward_to_qualification" });
    return;
  }

  const supabase = createServiceClient();
  const patch: Record<string, unknown> = { crm_stage: nextStage };
  if (pauseAi) {
    patch.ai_paused = true;
    patch.ai_paused_at = new Date().toISOString();
  }
  const { error } = await supabase.from("applications").update(patch).eq("id", leadId);
  if (error) {
    console.error("transitionStage: DB update failed", { leadId, fromStage, nextStage, error: error.message });
    logEvent(leadId, "stage_transition_error", fromStage, { nextStage, error: error.message });
    return;
  }
  logEvent(leadId, "stage_changed", nextStage, { from_stage: fromStage, to_stage: nextStage });
}

/**
 * Salus AI turn — substitui carolTurn.
 * Carrega o prompt e modelo do stage atual do lead (DB → fallback TS).
 * Contém todas as tools do pipeline Salus.
 */
export async function salusTurn(
  leadId: string,
  lead: Application,
  history: ModelMessage[],
  turnsInStage = 0,
): Promise<{ text: string; messagesSent: number }> {
  "use step";

  const stageConf = await getStageConfig(lead.crm_stage);
  if (!stageConf) {
    console.log("salusTurn: stage sem IA ativa", { leadId, stage: lead.crm_stage });
    return { text: "", messagesSent: 0 };
  }

  // Guard: Anthropic API requires the last message to be role "user".
  // When the hook queue holds messages received before Sofia's last reply, the
  // history (sorted by time) ends with an assistant message. Those queued
  // turns have nothing to respond to — skip them.
  if (history.length > 0 && history[history.length - 1].role === "assistant") {
    console.log("salusTurn: skipping — history ends with assistant message", {
      leadId, stage: lead.crm_stage, historyLen: history.length,
    });
    logEvent(leadId, "turn_skipped", lead.crm_stage, { reason: "last_message_is_assistant" });
    return { text: "", messagesSent: 0 };
  }

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const supabase = createServiceClient();
  let messagesSent = 0;
  const turnStart = Date.now();

  logEvent(leadId, "turn_start", lead.crm_stage, {
    model: stageConf.model,
    history_len: history.length,
  });

  const systemPrompt = carolSystemPrompt(lead, stageConf.prompt, turnsInStage);

  // ─── TOOLS ─────────────────────────────────────────────────────────────────

  const responder = tool({
    description: "Envia mensagem WhatsApp para o lead. Use para TODA resposta ao lead.",
    inputSchema: z.object({ texto: z.string() }),
    execute: async ({ texto }: { texto: string }) => {
      const { data: fresh } = await supabase.from("applications").select("ai_paused").eq("id", leadId).maybeSingle();
      if (fresh?.ai_paused) return { ok: false, reason: "ai_paused" };
      await sendWhatsapp(leadId, texto);
      messagesSent += 1;
      logEvent(leadId, "message_sent", lead.crm_stage, { preview: texto.slice(0, 120) });
      return { ok: true };
    },
  });

  const update_lead_metadata = tool({
    description: "Salva dados coletados sobre o lead durante a conversa.",
    inputSchema: z.object({
      localizacao_fl: z.string().optional(),
      dor_confirmada: z.string().optional(),
      tipo_imovel: z.string().optional(),
      arquetipo_icp: z.string().optional(),
      notas_extras: z.string().optional(),
    }),
    execute: async (meta: { localizacao_fl?: string; dor_confirmada?: string; tipo_imovel?: string; arquetipo_icp?: string; notas_extras?: string }) => {
      let existing: Record<string, unknown> = {};
      try { existing = JSON.parse(lead.qualification_notes ?? "{}"); } catch { /* ignore */ }
      const merged = { ...existing, ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) };
      await supabase.from("applications").update({ qualification_notes: JSON.stringify(merged) }).eq("id", leadId);
      return { ok: true };
    },
  });

  const registrar_tag = tool({
    description: `Registra uma característica do lead descoberta durante a conversa.
Use sempre que o lead revelar informação relevante — imóvel, família, dor, decisão ou sinal de interesse.
Para ICPs: use tags predefinidas quando encaixar, ou crie uma nova livremente se identificar um padrão novo.

TAGS PREDEFINIDAS (use quando encaixar):
• imovel: proprietario, inquilino, casa, apto
• familia: tem_filhos, tem_bebe, tem_pets
• dor: dor_gosto_cheiro, dor_calcario, dor_pele_cabelo, dor_saude_digestiva, dor_saude_pele, dor_alergia_agua, dor_gasto_filtros, dor_maquinas
• decisao: decisor, consulta_conjuge, consulta_gestor
• icp: icp_familia_saude, icp_economista, icp_estetico, icp_cetico — ou CRIE UM NOVO se o perfil não se encaixa
• sinal: interesse_alto, perguntou_preco, ja_pesquisou`,
    inputSchema: z.object({
      tag: z.string().describe("Nome da tag — use predefinidas ou crie nova livremente para novos padrões de ICP"),
      categoria: z.enum(["imovel", "familia", "dor", "decisao", "icp", "sinal"]).describe("Categoria organizacional da tag"),
      valor: z.string().optional().describe("Contexto opcional, ex: 'dor de barriga frequente' ou 'mora em Hialeah'"),
    }),
    execute: async ({ tag, categoria, valor }: { tag: string; categoria: "imovel" | "familia" | "dor" | "decisao" | "icp" | "sinal"; valor?: string }) => {
      const { data: current } = await supabase.from("applications").select("lead_tags").eq("id", leadId).maybeSingle();
      const existing: Array<{ tag: string; categoria: string; valor?: string; set_at: string }> = (current?.lead_tags as Array<{ tag: string; categoria: string; valor?: string; set_at: string }>) ?? [];
      const alreadySet = existing.some((t) => t.tag === tag);
      if (alreadySet) return { ok: true, skipped: true };
      const updated = [...existing, { tag, categoria, valor, set_at: new Date().toISOString() }];
      await supabase.from("applications").update({ lead_tags: updated }).eq("id", leadId);
      logEvent(leadId, "tag_set", lead.crm_stage, { tag, categoria, valor });
      return { ok: true };
    },
  });

  const notificar_agendamento_ze = tool({
    description: "Notifica o Zé via WhatsApp para confirmar agenda do Marcelo ou alertar lead quente.",
    inputSchema: z.object({
      mensagem: z.string().describe("Mensagem completa para o Zé com contexto do lead"),
      urgencia: z.enum(["ALTA", "MEDIA", "BAIXA"]).default("MEDIA"),
    }),
    execute: async ({ mensagem, urgencia }: { mensagem: string; urgencia: "ALTA" | "MEDIA" | "BAIXA" }) => {
      const texto = urgencia === "ALTA" ? `🔴 URGENTE\n${mensagem}` : mensagem;
      try {
        const { getUazapiConfig } = await import("../../lib/crm-config");
        const [uazapi, notifPhone] = await Promise.all([getUazapiConfig(), getNotificationPhone()]);
        if (!notifPhone) {
          console.warn("notificar_agendamento_ze: notification_phone não configurado");
          return { ok: false, reason: "notification_phone_not_set" };
        }
        if (uazapi) {
          await fetch(`${uazapi.url}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: uazapi.token },
            body: JSON.stringify({ number: notifPhone.replace(/\D/g, ""), text: texto }),
          });
        }
      } catch (err) {
        console.error("notificar_agendamento_ze failed", String(err));
      }
      return { ok: true };
    },
  });

  const escalar_para_humano = tool({
    description: "Pausa a IA e escala para atendimento humano. Use quando a situação está fora do seu escopo.",
    inputSchema: z.object({
      motivo: z.string(),
      flag: z.string().optional(),
    }),
    execute: async ({ motivo }: { motivo: string; flag?: string }) => {
      await supabase.from("applications")
        .update({ ai_paused: true, ai_paused_at: new Date().toISOString(), notes: `[Escalado para humano: ${motivo}]` })
        .eq("id", leadId);
      return { ok: true };
    },
  });

  const register_opt_out = tool({
    description: "Lead pediu para parar de receber mensagens (LGPD/CCPA). Para TUDO.",
    inputSchema: z.object({ frase_detectada: z.string().optional() }),
    execute: async (_: { frase_detectada?: string }) => {
      await supabase.from("applications")
        .update({ do_not_contact: true, crm_stage: "perdido", ai_paused: true })
        .eq("id", leadId);
      return { ok: true };
    },
  });

  const archive_lead = tool({
    description: "Marca o lead como perdido ou descartado com motivo.",
    inputSchema: z.object({
      motivo: z.string(),
      tipo: z.enum(["perdido", "descartado"]).default("perdido"),
    }),
    execute: async ({ motivo, tipo }: { motivo: string; tipo: "perdido" | "descartado" }) => {
      await supabase.from("applications")
        .update({ crm_stage: tipo, descarte_motivo: motivo, ai_paused: true })
        .eq("id", leadId);
      return { ok: true };
    },
  });

  const mover_para_agendado = tool({
    description: "Move o lead para Agendado assim que ele confirmar DIA + HORÁRIO (intenção clara de receber a visita). NÃO exija endereço para mover — o endereço e os demais itens (quem recebe, animal, torneiras) são coletados JÁ na etapa Agendado. Se souber a data/hora em ISO (ex: '2026-06-13T14:00:00'), passe em datetime_iso para o Google Calendar.",
    inputSchema: z.object({
      data_visita:    z.string().describe("Data confirmada pelo lead, ex: 'quinta dia 13'"),
      horario_visita: z.string().describe("Horário confirmado pelo lead, ex: '11h'"),
      local_visita:   z.string().optional().describe("Endereço, se o lead já informou. Opcional — pode coletar na etapa Agendado."),
      datetime_iso:   z.string().optional().describe("Data e hora em ISO 8601, ex: '2026-06-13T14:00:00' — para integração com Google Calendar"),
    }),
    execute: async ({ data_visita, horario_visita, local_visita = "", datetime_iso }: { data_visita: string; horario_visita: string; local_visita?: string; datetime_iso?: string }) => {
      if (!data_visita.trim() || !horario_visita.trim()) {
        return { ok: false, reason: "Para mover ao Agendado, confirme ao menos DIA + HORÁRIO com o lead." };
      }

      let calendarEventLink: string | null = null;

      // Cria o evento no Google Calendar só com data/hora ISO E endereço (na etapa Agendado).
      // No move antecipado vindo de aquecendo (sem endereço) o evento não é criado ainda.
      if (datetime_iso && local_visita.trim()) {
        try {
          const gcalCfg = await getGoogleCalendarConfig();
          if (gcalCfg) {
            const startIso = new Date(datetime_iso).toISOString();
            const endIso   = new Date(new Date(datetime_iso).getTime() + 90 * 60 * 1000).toISOString(); // +90min

            const available = await isSlotAvailable(gcalCfg, startIso, endIso);
            if (!available) {
              return {
                ok: false,
                reason: `Horário ${horario_visita} de ${data_visita} está ocupado no calendário do Marcelo. Pergunte ao lead outra opção de data/horário.`,
              };
            }

            calendarEventLink = await createCalendarEvent(gcalCfg, {
              summary:     `Visita Salus Water — ${lead.full_name}`,
              description: `Lead: ${lead.full_name} | Tel: ${lead.phone} | Endereço: ${local_visita}`,
              location:    local_visita,
              startIso,
              endIso,
            });
            logEvent(leadId, "calendar_event_created", "agendado", { calendarEventLink, startIso });
          }
        } catch (err) {
          // Falha no Google Calendar não bloqueia o agendamento
          console.warn("mover_para_agendado: Google Calendar error (non-blocking)", String(err));
          logEvent(leadId, "calendar_event_error", lead.crm_stage, { error: String(err) });
        }
      }

      let existing: Record<string, unknown> = {};
      try { existing = JSON.parse(lead.qualification_notes ?? "{}"); } catch { /* ignore */ }
      const merged = { ...existing, data_visita, horario_visita, local_visita, ...(calendarEventLink ? { calendar_event_link: calendarEventLink } : {}) };
      await supabase.from("applications")
        .update({ qualification_notes: JSON.stringify(merged), call_scheduled_at: new Date().toISOString() })
        .eq("id", leadId);
      await transitionStage(leadId, lead.crm_stage, "agendado");
      logEvent(leadId, "visit_scheduled", "agendado", { data_visita, horario_visita, local_visita, calendarEventLink });
      return { ok: true, calendarEventLink };
    },
  });

  const agendar_retorno = tool({
    description: "Registra data para retomar contato e move lead para Contato Futuro. Use quando o lead pediu pra falar depois de uma data específica ('me liga depois do dia 13', 'só semana que vem', 'me chama em julho').",
    inputSchema: z.object({
      data_retorno: z.string().describe("Data alvo no formato YYYY-MM-DD ou descrição legível ex: '2024-06-13'"),
      motivo: z.string().optional().describe("O que o lead disse — contextualiza o retorno"),
    }),
    execute: async ({ data_retorno, motivo }: { data_retorno: string; motivo?: string }) => {
      let reengageIso: string | null = null;
      try {
        const parsed = new Date(data_retorno);
        if (!isNaN(parsed.getTime())) reengageIso = parsed.toISOString();
      } catch { /* data inválida — salva mesmo assim */ }
      const patch: Record<string, unknown> = {
        crm_stage: "contato_futuro",
        reengage_at: reengageIso,
      };
      if (motivo) patch.notes = `[Retomar em ${data_retorno}: ${motivo}]`;
      await supabase.from("applications").update(patch).eq("id", leadId);
      logEvent(leadId, "stage_changed", "contato_futuro", {
        from_stage: lead.crm_stage,
        to_stage: "contato_futuro",
        reason: motivo,
        reengage_at: data_retorno,
      });
      return { ok: true };
    },
  });

  // ─── PROMOTION TOOLS ───────────────────────────────────────────────────────
  // Nomes semânticos alinhados com os labels do kanban (migration 002 IDs).
  // Aliases com nomes antigos mantidos para compatibilidade com prompts configurados no DB.

  const mkP = (nextStage: string, pauseAi = false) => tool({
    description: `Move o lead para o stage ${nextStage}.`,
    inputSchema: z.object({ motivo: z.string().optional() }),
    execute: async (_: { motivo?: string }) => {
      await transitionStage(leadId, lead.crm_stage, nextStage, pauseAi);
      return { ok: true };
    },
  });

  // ── Tools de promoção — IDs canônicos (pipeline definitivo) ───────────
  const mover_para_lead_contatado = mkP("lead_contatado");          // volta para aguardando resposta
  const mover_para_respondeu      = mkP("respondeu");               // lead respondeu → qualificação
  const mover_para_aquecendo      = mkP("aquecendo");               // engajado mas não pronto para agendar
  // mover_para_agendado — definido acima com gate determinístico (data + horário + endereço)
  const mover_para_objecao        = mkP("objecao");                 // objeção comercial ativa
  const mover_para_contato_futuro = mkP("contato_futuro");          // reativação futura
  const mover_para_perdido        = mkP("perdido", true);           // saiu do funil → pausa IA

  const mover_para_pos_visita = tool({
    description: "Move lead para Pós-Visita após Marcelo ter visitado. Informe se a visita foi realizada ou se o lead não atendeu (no_show).",
    inputSchema: z.object({
      status_visita: z.enum(["realizada", "no_show"]).describe("'realizada' se Marcelo visitou; 'no_show' se lead não atendeu"),
      observacoes: z.string().optional().describe("Contexto adicional sobre a visita"),
    }),
    execute: async ({ status_visita, observacoes }: { status_visita: "realizada" | "no_show"; observacoes?: string }) => {
      let existing: Record<string, unknown> = {};
      try { existing = JSON.parse(lead.qualification_notes ?? "{}"); } catch { /* ignore */ }
      const merged = { ...existing, visita_status: status_visita, ...(observacoes ? { visita_observacoes: observacoes } : {}) };
      await supabase.from("applications").update({ qualification_notes: JSON.stringify(merged) }).eq("id", leadId);
      if (status_visita === "no_show") {
        await supabase.from("applications")
          .update({ ai_paused: true, ai_paused_at: new Date().toISOString(), notes: `[No-show na visita técnica]` })
          .eq("id", leadId);
        logEvent(leadId, "visit_no_show", lead.crm_stage, { observacoes });
        return { ok: true, action: "escalado_no_show" };
      }
      await transitionStage(leadId, lead.crm_stage, "pos_visita");
      return { ok: true };
    },
  });

  const mover_para_fechado = tool({
    description: "Move lead para Fechado. Use APENAS quando lead confirmou explicitamente que vai fechar negócio e o valor foi acordado.",
    inputSchema: z.object({
      valor_acordado: z.string().describe("Valor ou plano acordado, ex: '$4.500 à vista' ou 'plano mensal $89/mês'"),
      confirmacao_lead: z.boolean().describe("Lead confirmou explicitamente que vai fechar? Só marque true se disse claramente que sim."),
    }),
    execute: async ({ valor_acordado, confirmacao_lead }: { valor_acordado: string; confirmacao_lead: boolean }) => {
      if (!confirmacao_lead) {
        return { ok: false, reason: "Lead ainda não confirmou o fechamento explicitamente. Continue a conversa até obter confirmação clara." };
      }
      let existing: Record<string, unknown> = {};
      try { existing = JSON.parse(lead.qualification_notes ?? "{}"); } catch { /* ignore */ }
      const merged = { ...existing, valor_acordado, fechado_em: new Date().toISOString() };
      await supabase.from("applications")
        .update({ qualification_notes: JSON.stringify(merged), ai_paused: true, ai_paused_at: new Date().toISOString() })
        .eq("id", leadId);
      logEvent(leadId, "lead_fechado", "fechado", { valor_acordado });
      await transitionStage(leadId, lead.crm_stage, "fechado");
      return { ok: true };
    },
  });

  // ── Aliases legados (compatibilidade com prompts configurados no DB) ────
  const promover_para_followup_1       = mover_para_lead_contatado;
  const promover_para_diagnostico      = mover_para_respondeu;
  const promover_para_agendamento      = mover_para_agendado;
  const promover_para_visita_tecnica   = mover_para_agendado;
  const promover_para_proposta_enviada = mover_para_pos_visita;
  const promover_para_followup_2       = mover_para_pos_visita;
  const promover_para_negociacao       = mover_para_objecao;
  const promover_para_followup_3       = mover_para_pos_visita;
  const promover_para_fechamento       = mover_para_fechado;
  const promover_para_contato_futuro   = mover_para_contato_futuro;

  // ─── EXECUTE ───────────────────────────────────────────────────────────────

  console.log("salusTurn: invoking", { leadId, stage: lead.crm_stage, model: stageConf.model, historyLen: history.length });

  const result = await generateText({
    model: anthropic(stageConf.model),
    temperature: 0.8,
    system: systemPrompt,
    messages: history,
    tools: {
      // ── Ações ──────────────────────────────────────────────────────────
      responder,
      registrar_tag,
      update_lead_metadata,
      notificar_agendamento_ze,
      agendar_retorno,         // universal: qualquer etapa → contato_futuro com data
      escalar_para_humano,
      register_opt_out,
      archive_lead,
      // ── Promoções canônicas ────────────────────────────────────────────
      mover_para_lead_contatado,
      mover_para_respondeu,
      mover_para_aquecendo,
      mover_para_agendado,
      mover_para_objecao,      // universal: qualquer etapa → objecao
      mover_para_pos_visita,
      mover_para_contato_futuro,
      mover_para_fechado,
      mover_para_perdido,
      // ── Aliases legados (compatibilidade com prompts no DB) ────────────
      promover_para_followup_1,
      promover_para_diagnostico,
      promover_para_agendamento,
      promover_para_visita_tecnica,
      promover_para_proposta_enviada,
      promover_para_followup_2,
      promover_para_negociacao,
      promover_para_followup_3,
      promover_para_fechamento,
      promover_para_contato_futuro,
    },
    stopWhen: stepCountIs(5),
  });

  const text = result.text ?? "";

  console.log("salusTurn: done", { leadId, stage: lead.crm_stage, messagesSent, finishReason: result.finishReason });

  // Fallback A: IA gerou texto mas não usou a tool responder
  if (messagesSent === 0 && text.trim().length > 0) {
    const { data: fresh } = await supabase.from("applications").select("ai_paused").eq("id", leadId).maybeSingle();
    if (!fresh?.ai_paused) {
      await sendWhatsapp(leadId, text.trim());
      messagesSent += 1;
      logEvent(leadId, "message_sent_fallback_text", lead.crm_stage, { preview: text.trim().slice(0, 120) });
    }
  }

  // Fallback B: IA parou sem texto e sem mensagem — retry com prompt forçado (max 1x)
  if (messagesSent === 0) {
    console.warn("salusTurn: messagesSent=0 sem texto — tentando retry forçado", { leadId, stage: lead.crm_stage, finishReason: result.finishReason });
    logEvent(leadId, "turn_no_message", lead.crm_stage, { finish_reason: result.finishReason });

    try {
      const retryResult = await generateText({
        model: anthropic("claude-sonnet-4-6"),
        temperature: 0.7,
        system: systemPrompt + "\n\n⚠️ ATENÇÃO: Você DEVE chamar a tool 'responder' agora. Responda à última mensagem do lead.",
        messages: history,
        tools: { responder },
        stopWhen: stepCountIs(2),
      });
      if (messagesSent === 0 && (retryResult.text ?? "").trim().length > 0) {
        const { data: fresh2 } = await supabase.from("applications").select("ai_paused").eq("id", leadId).maybeSingle();
        if (!fresh2?.ai_paused) {
          await sendWhatsapp(leadId, retryResult.text!.trim());
          messagesSent += 1;
          logEvent(leadId, "message_sent_fallback_retry", lead.crm_stage, { preview: retryResult.text!.trim().slice(0, 120) });
        }
      }
    } catch (retryErr) {
      console.error("salusTurn: fallback retry failed", { leadId, err: String(retryErr) });
    }
  }

  logEvent(leadId, "turn_complete", lead.crm_stage, {
    messages_sent: messagesSent,
    finish_reason: result.finishReason,
    duration_ms: Date.now() - turnStart,
  });

  return { text, messagesSent };
}
