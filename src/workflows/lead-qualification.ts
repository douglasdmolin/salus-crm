import { createHook, FatalError } from "workflow";
import type { ModelMessage } from "ai";
import { getLead, updateLeadStatus, getConversationHistory } from "./steps/supabase";
import { salusTurn } from "./steps/salus-turn";
import { sendWhatsapp } from "./steps/uazapi";
import { classifySentiment } from "./steps/sentiment";
import { AI_DISABLED_STAGES } from "./prompts/stages/index";
import { createServiceClient } from "../lib/supabase";

async function sendFirstMessage(leadId: string, mensagem: string): Promise<void> {
  "use step";
  await sendWhatsapp(leadId, mensagem);
}

/**
 * Mecanismo de backup: se a Sofia não chamou nenhuma tool de promoção
 * após N respostas do lead nessa etapa, avança automaticamente.
 * Independe da decisão da Sofia — garante que o lead nunca fica preso.
 * Usa os IDs da migration 002.
 */
async function autoAdvanceIfStuck(
  leadId: string,
  stageBeforeTurn: string,
  turnsInStage: number,
): Promise<void> {
  "use step";

  // turnsInStage = nº de turnos do lead NA ETAPA ATUAL (reseta a cada mudança de stage).
  // NÃO é o reply_count cumulativo — isso evita avançar por engano um lead que só
  // acumulou respostas progredindo por etapas anteriores.
  // Regras: [etapa_atual, turnos_mínimos_na_etapa, próxima_etapa]
  const rules: Array<[string, number, string]> = [
    // Lead Contatado: basta o lead responder 1x → Respondeu (qualificação real é lá, com sonnet).
    // Não dependemos do haiku chamar mover_para_respondeu; o avanço é determinístico.
    ["lead_contatado", 1, "respondeu"],
    // Respondeu: 4+ respostas sem qualificar → Aquecendo
    ["respondeu", 4, "aquecendo"],
    // Aquecendo: 8+ respostas sem agendar → Contato Futuro
    ["aquecendo", 8, "contato_futuro"],
    // Legados
    ["followup_1", 1, "respondeu"],
    ["diagnostico", 4, "aquecendo"],
    ["contato_respondido_pela_ia", 5, "aquecendo"],
  ];

  const rule = rules.find(([stage]) => stage === stageBeforeTurn);
  if (!rule || turnsInStage < rule[1]) return;

  // Verifica se a Sofia já avançou o stage durante o turno
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("applications")
    .select("crm_stage")
    .eq("id", leadId)
    .maybeSingle();

  if (!data || data.crm_stage !== stageBeforeTurn) return; // Sofia já avançou

  const nextStage = rule[2];
  console.log("autoAdvanceIfStuck: avançando stage", { leadId, stageBeforeTurn, nextStage, turnsInStage });

  await supabase
    .from("applications")
    .update({ crm_stage: nextStage })
    .eq("id", leadId);
}

type IncomingMessage = { text: string; timestamp: number };

// Teto de iterações por run do workflow. Conversas longas (objeção + agendamento)
// passam fácil de 12; ao atingir o teto o workflow encerra e o webhook reinicia
// um novo run na próxima mensagem (ver api/uazapi/webhook).
const MAX_TURNS = 40;

export async function leadQualificationWorkflow(leadId: string, hookToken?: string) {
  "use workflow";

  const lead = await getLead(leadId);
  if (!lead) throw new FatalError(`Application ${leadId} não existe`);

  // Etapa 1: abertura (lead em stage inicial) OU retomada (workflow reiniciado).
  // IDs de entrada válidos: lead_qualificado (migration 002) e novo (legado migration 007)
  const INITIAL_STAGES = ["lead_qualificado", "novo"];
  if (INITIAL_STAGES.includes(lead.crm_stage)) {
    // Lead novo: envia abertura (mensagem_sugerida ou gerada pela IA) e avança o stage.
    if (lead.mensagem_sugerida) {
      await sendFirstMessage(leadId, lead.mensagem_sugerida);
    } else {
      const nomeAbertura = lead.nome_para_mensagem ?? lead.full_name.split(" ")[0];
      const kickstart: ModelMessage[] = [
        { role: "user", content: `[Novo lead cadastrado — envie a mensagem de abertura para ${nomeAbertura}]` },
      ];
      await salusTurn(leadId, lead, kickstart);
    }
    // Avança para "Lead Contatado" — a Sofia só moverá para "Respondeu" quando o lead responder.
    await updateLeadStatus(leadId, "lead_contatado");
  } else if (!lead.ai_paused && !AI_DISABLED_STAGES.has(lead.crm_stage)) {
    // Retomada: o webhook reiniciou um workflow morto. NÃO reenviar abertura —
    // responder imediatamente a mensagem pendente (já gravada em messages_received)
    // antes de entrar no loop de hook.
    const history = await getConversationHistory(leadId);
    const messages: ModelMessage[] = history.map((m) => ({
      role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));
    await salusTurn(leadId, lead, messages, lead.reply_count);
    // Primeiro turno nesta etapa neste run → 1 (não cumulativo). Garante o avanço
    // determinístico de lead_contatado (threshold 1) sem disparar etapas posteriores.
    await autoAdvanceIfStuck(leadId, lead.crm_stage, 1);
  }

  // Etapa 2: hook iterável para respostas — token único por run evita HookConflictError
  const token = hookToken ?? `lead:${leadId}:inbound`;
  const inboundHook = createHook<IncomingMessage>({ token });

  // Etapa 3: loop de conversa com prompt-swap por stage
  let turnos = 0;
  // Conta turnos NA ETAPA ATUAL (reseta a cada mudança de stage). O backstop
  // determinístico usa ESTE valor, não o reply_count cumulativo — senão um lead
  // que progrediu por várias etapas atinge os thresholds e é avançado por engano
  // (ex: aquecendo→contato_futuro no meio do agendamento).
  let lastStage: string | null = null;
  let turnsInCurrentStage = 0;

  for await (const msg of inboundHook) {
    if (msg?.text) await classifySentiment(leadId, msg.text);

    let freshLead = await getLead(leadId);
    if (!freshLead) break;

    // Se o card foi movido manualmente de volta para o stage inicial (já enviamos a abertura),
    // avança para lead_contatado antes de qualquer verificação.
    if (INITIAL_STAGES.includes(freshLead.crm_stage)) {
      await updateLeadStatus(leadId, "lead_contatado");
      freshLead = { ...freshLead, crm_stage: "lead_contatado" };
    }

    // Stages de pausa humana ou terminais — IA não responde
    if (freshLead.ai_paused || AI_DISABLED_STAGES.has(freshLead.crm_stage)) {
      console.log("leadQualificationWorkflow: AI pausada/stage terminal", {
        leadId, stage: freshLead.crm_stage, aiPaused: freshLead.ai_paused,
      });
      continue;
    }

    // Contador por etapa: reseta quando o lead muda de stage.
    if (freshLead.crm_stage !== lastStage) {
      lastStage = freshLead.crm_stage;
      turnsInCurrentStage = 0;
    }
    turnsInCurrentStage++;

    const history = await getConversationHistory(leadId);

    const messages: ModelMessage[] = history.map((m) => ({
      role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    // salusTurn recebe o reply_count cumulativo como contexto do prompt (inalterado).
    await salusTurn(leadId, freshLead, messages, freshLead.reply_count);

    // ── Mecanismo de backup determinístico ────────────────────────────────
    // Se a Sofia não chamou nenhuma ferramenta de promoção após N turnos NESTA
    // etapa, o sistema avança o stage automaticamente sem depender da IA.
    await autoAdvanceIfStuck(leadId, freshLead.crm_stage, turnsInCurrentStage);

    turnos++;
    if (turnos >= MAX_TURNS) {
      console.log("leadQualificationWorkflow: max turns reached", { leadId, turnos });
      break;
    }
  }
}
