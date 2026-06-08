import { generateText, tool, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { sendWhatsapp } from "./uazapi";
import { createServiceClient, type Application } from "../../lib/supabase";
import { carolSystemPrompt } from "../prompts/ai-persona";
import { getFallbackPrompt, getFallbackModel, AI_DISABLED_STAGES } from "../prompts/stages/index";
import { getCarolConfig, getNotificationPhone } from "../../lib/crm-config";

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
6. Se o lead pedir mais informações sobre a empresa ou quiser conhecer melhor a Salus → passe o site: https://watersalus.com/ — ex: "Você pode conhecer mais sobre a Salus em https://watersalus.com/ 😊"`;
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

/** Atualiza crm_stage no banco, pausa IA se necessário e loga a transição */
async function transitionStage(
  leadId: string,
  fromStage: string,
  nextStage: string,
  pauseAi = false,
) {
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

  const confirmar_visita = tool({
    description: "Registra data, hora e endereço da visita técnica do Marcelo. Use quando o lead confirmou um horário específico. O lead permanece em Agendado até a visita acontecer — após a visita, use mover_para_pos_visita.",
    inputSchema: z.object({
      data_visita: z.string(),
      horario_visita: z.string(),
      endereco: z.string().optional(),
      observacoes: z.string().optional(),
    }),
    execute: async ({ data_visita, horario_visita, endereco, observacoes }: { data_visita: string; horario_visita: string; endereco?: string; observacoes?: string }) => {
      let existing: Record<string, unknown> = {};
      try { existing = JSON.parse(lead.qualification_notes ?? "{}"); } catch { /* ignore */ }
      const merged = { ...existing, data_visita, horario_visita, endereco, observacoes };
      await supabase.from("applications")
        .update({ qualification_notes: JSON.stringify(merged), call_scheduled_at: new Date().toISOString() })
        .eq("id", leadId);
      logEvent(leadId, "visit_confirmed", lead.crm_stage, { data_visita, horario_visita, endereco });
      return { ok: true };
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
  const mover_para_agendado       = mkP("agendado");                // confirmar logística da visita
  const mover_para_objecao        = mkP("objecao");                 // objeção comercial ativa
  const mover_para_pos_visita     = mkP("pos_visita");              // Marcelo já visitou
  const mover_para_contato_futuro = mkP("contato_futuro");          // reativação futura
  const mover_para_fechado        = mkP("fechado", true);           // contrato fechado → pausa IA
  const mover_para_perdido        = mkP("perdido", true);           // saiu do funil → pausa IA

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
      update_lead_metadata,
      notificar_agendamento_ze,
      confirmar_visita,
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
