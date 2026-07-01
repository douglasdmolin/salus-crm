import { createHook, FatalError, sleep } from "workflow";
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
    // Respondeu: basta 2 turnos sem qualificar → Aquecendo (avança rápido; não prende o lead)
    ["respondeu", 2, "aquecendo"],
    // Aquecendo: só vira contato_futuro depois de MUITO tempo sem agendar (12 turnos).
    // Antes era 8 e parkava lead engajado que estava prestes a marcar a visita.
    ["aquecendo", 12, "contato_futuro"],
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

// Janela de agregação de mensagens em rajada (segundos). Quando o lead manda
// várias mensagens seguidas, só a última dispara uma resposta — evita a Sofia
// responder cada fragmento separadamente (respostas duplicadas).
const DEBOUNCE_SECONDS = 6;

/** Epoch ms da última mensagem recebida do lead (usado pelo debounce). */
async function latestInboundAtMs(leadId: string): Promise<number> {
  "use step";
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("messages_received")
    .select("received_at")
    .eq("application_id", leadId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.received_at ? new Date(data.received_at as string).getTime() : 0;
}

/**
 * Limpa o workflow_run_id ao término do run — SÓ se este run ainda é o ativo (mesmo
 * hook_token), para não clobberar um workflow mais novo que tenha assumido o lead.
 * Assim, no webhook, run_id != null passa a significar "há workflow vivo" de forma
 * confiável — o webhook nunca precisa (nem deve) reiniciar, evitando runs duplicados.
 */
async function clearWorkflowRun(leadId: string, token: string): Promise<void> {
  "use step";
  const supabase = createServiceClient();
  await supabase
    .from("applications")
    .update({ workflow_run_id: null })
    .eq("id", leadId)
    .eq("hook_token", token);
}

export async function leadQualificationWorkflow(leadId: string, hookToken?: string) {
  "use workflow";

  const lead = await getLead(leadId);
  if (!lead) throw new FatalError(`Application ${leadId} não existe`);

  // Hook criado ANTES de qualquer resposta: mensagens que chegam durante o primeiro
  // turno ficam no buffer e são tratadas pelo loop — evita o webhook reiniciar um
  // run concorrente (que gerava respostas duplicadas).
  const token = hookToken ?? `lead:${leadId}:inbound`;
  const inboundHook = createHook<IncomingMessage>({ token });

  // Etapa 1: abertura (lead em stage inicial) OU retomada (workflow reiniciado/inbound).
  // IDs de entrada válidos: lead_qualificado (migration 002) e novo (legado migration 007)
  const INITIAL_STAGES = ["lead_qualificado", "novo"];
  // Marca d'água: epoch ms da última mensagem já respondida. Evita que o loop responda
  // de novo a uma rajada que o branch de abertura (ou um turno anterior) já cobriu.
  let handledUpToMs = 0;
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
    // Retomada/inbound: debounce e responde UMA vez à rajada pendente, lendo o histórico
    // completo. Marca até onde já respondeu para o loop não repetir a mesma rajada.
    await sleep(`${DEBOUNCE_SECONDS}s`);
    const latest = await latestInboundAtMs(leadId);
    const history = await getConversationHistory(leadId);
    const messages: ModelMessage[] = history.map((m) => ({
      role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));
    await salusTurn(leadId, lead, messages, lead.reply_count);
    // Primeiro turno nesta etapa neste run → 1 (não cumulativo).
    await autoAdvanceIfStuck(leadId, lead.crm_stage, 1);
    handledUpToMs = latest;
  }

  // Etapa 3: loop de conversa com prompt-swap por stage
  let turnos = 0;
  // Conta turnos NA ETAPA ATUAL (reseta a cada mudança de stage). O backstop
  // determinístico usa ESTE valor, não o reply_count cumulativo — senão um lead
  // que progrediu por várias etapas atinge os thresholds e é avançado por engano
  // (ex: aquecendo→contato_futuro no meio do agendamento).
  let lastStage: string | null = null;
  let turnsInCurrentStage = 0;

  for await (const msg of inboundHook) {
    // Debounce: junta mensagens em rajada. refMs = horário DESTA mensagem; se uma
    // mais nova chegar durante a espera, pula esta e deixa a última responder.
    const tsRaw = msg?.timestamp ?? 0;
    const refMs = tsRaw === 0 ? Date.now() : tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
    await sleep(`${DEBOUNCE_SECONDS}s`);
    const latest = await latestInboundAtMs(leadId);
    // Chegou mensagem mais nova durante o debounce → deixa a última responder.
    if (latest > refMs) continue;
    // Branch de abertura (ou turno anterior) já respondeu até aqui → não repete a rajada.
    if (latest <= handledUpToMs) continue;

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
    handledUpToMs = latest;

    turnos++;
    if (turnos >= MAX_TURNS) {
      console.log("leadQualificationWorkflow: max turns reached", { leadId, turnos });
      break;
    }
  }

  // Encerrou (break/MAX_TURNS) → libera o run_id para que a próxima mensagem inicie um
  // workflow limpo. Fica FORA de try/finally de propósito: o WDK suspende via sinal de
  // controle nos sleep/hook, e um finally capturaria esse sinal e quebraria o workflow.
  await clearWorkflowRun(leadId, token);
}
