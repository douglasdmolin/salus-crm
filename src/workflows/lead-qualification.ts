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

  // turnsInStage = reply_count total do lead (proxy confiável, cresce a cada mensagem recebida).
  // Regras: [etapa_atual, reply_count_mínimo, próxima_etapa]
  const rules: Array<[string, number, string]> = [
    // Lead Contatado: respondeu mas Sofia não avançou em 2 turnos → Respondeu
    ["lead_contatado", 2, "respondeu"],
    // Respondeu: 4+ respostas sem qualificar → Aquecendo
    ["respondeu", 4, "aquecendo"],
    // Aquecendo: 8+ respostas sem agendar → Contato Futuro
    ["aquecendo", 8, "contato_futuro"],
    // Legados
    ["followup_1", 2, "respondeu"],
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

const MAX_TURNS = 12;

export async function leadQualificationWorkflow(leadId: string, hookToken?: string) {
  "use workflow";

  const lead = await getLead(leadId);
  if (!lead) throw new FatalError(`Application ${leadId} não existe`);

  // Etapa 1: mensagem de abertura
  // Se o lead tem mensagem_sugerida, envia diretamente (sem IA).
  // Caso contrário, o agente de stage gera a abertura.
  // IDs de entrada válidos: lead_qualificado (migration 002) e novo (legado migration 007)
  const INITIAL_STAGES = ["lead_qualificado", "novo"];
  if (lead.mensagem_sugerida && INITIAL_STAGES.includes(lead.crm_stage)) {
    await sendFirstMessage(leadId, lead.mensagem_sugerida);
  } else {
    const nomeAbertura = lead.nome_para_mensagem ?? lead.full_name.split(" ")[0];
    const kickstart: ModelMessage[] = [
      { role: "user", content: `[Novo lead cadastrado — envie a mensagem de abertura para ${nomeAbertura}]` },
    ];
    await salusTurn(leadId, lead, kickstart);
  }
  // Avança para "Lead Contatado" — indica que a mensagem foi enviada.
  // A Sofia só moverá para "Respondeu" quando o lead REALMENTE responder.
  if (INITIAL_STAGES.includes(lead.crm_stage)) {
    await updateLeadStatus(leadId, "lead_contatado");
  }

  // Etapa 2: hook iterável para respostas — token único por run evita HookConflictError
  const token = hookToken ?? `lead:${leadId}:inbound`;
  const inboundHook = createHook<IncomingMessage>({ token });

  // Etapa 3: loop de conversa com prompt-swap por stage
  let turnos = 0;

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

    const history = await getConversationHistory(leadId);

    // reply_count é incrementado pelo webhook a cada resposta do lead (confiável e sem query extra)
    const turnsInStage = freshLead.reply_count;

    const messages: ModelMessage[] = history.map((m) => ({
      role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    // salusTurn usa o crm_stage atual do lead para escolher prompt + modelo
    await salusTurn(leadId, freshLead, messages, turnsInStage);

    // ── Mecanismo de backup determinístico ────────────────────────────────
    // Se a Sofia não chamou nenhuma ferramenta de promoção após N respostas
    // do lead, o sistema avança o stage automaticamente sem depender da IA.
    await autoAdvanceIfStuck(leadId, freshLead.crm_stage, turnsInStage);

    turnos++;
    if (turnos >= MAX_TURNS) {
      console.log("leadQualificationWorkflow: max turns reached", { leadId, turnos });
      break;
    }
  }
}
