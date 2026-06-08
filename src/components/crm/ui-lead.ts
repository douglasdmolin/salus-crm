import type { Application, CrmStage } from "../../lib/supabase";

export type UiLead = {
  id: string;
  stage: CrmStage;
  name: string;
  company: string;
  role: string;
  phone: string;
  email: string;
  assignee: string;
  aiScore: number;
  sentiment: "positive" | "neutral" | "negative";
  nextAction: string;
  nextActionType: "call" | "meet" | "send" | "qualify" | "wait" | "done";
  lastMessage: string;
  lastMessageDirection: "in" | "out" | null;
  lastMessageTime: string;
  unread: number;
  createdAt: string;
  signupDate: string;
  aiSummary: string;
  aiPaused: boolean;
  descarteMotivo: string | null;
};

/** Optional messages lookup: lead id → { texto, direction, ts } of most recent message. */
export type MessageIndex = Record<string, { texto: string; direction: "in" | "out"; ts: string }>;

/** Absolute date in pt-BR — "17/04/2026" */
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ontem";
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Legacy parser — still used as fallback when applications.role/company are null
 * (old test leads had structured data in `notes`). For new leads, role/company
 * come directly from the AI tools anotar_cargo / anotar_empresa.
 */
function parseNotesFallback(notes: string | null): { role: string; company: string } {
  const out = { role: "", company: "" };
  if (!notes) return out;
  for (const part of notes.split("·").map((s) => s.trim())) {
    const [k, ...rest] = part.split(":");
    const val = rest.join(":").trim();
    if (/cargo/i.test(k)) out.role = val;
    else if (/empresa/i.test(k)) out.company = val;
  }
  return out;
}

function deriveAssignee(stage: CrmStage): string {
  if (["novo", "contato_respondido_pela_ia", "em_contato", "descartado", "contato_futuro"].includes(stage)) return "ai";
  return "closer";
}

/**
 * When OSINT score is absent, derive a Carol-implicit score based on stage + conversation state.
 * This gives visual signal before OSINT runs.
 */
function deriveScore(app: Application): number {
  if (app.enrichment_score !== null && app.enrichment_score !== undefined) return app.enrichment_score;
  const hasReply = (app.reply_count ?? 0) > 0;
  switch (app.crm_stage) {
    case "novo": return 45;
    case "contato_respondido_pela_ia": return hasReply ? 65 : 55;
    case "em_contato": return hasReply ? 72 : 60;
    case "ligacao_agendada": return 80;
    case "call_agendada": return 85;
    case "em_negociacao": return 90;
    case "ganho": return 100;
    case "perdido": return 20;
    case "descartado": return 15;
    case "contato_futuro": return 40;
    default: return 50;
  }
}

function deriveNextAction(app: Application, lastMsg?: { texto: string; direction: "in" | "out" }): { text: string; type: UiLead["nextActionType"] } {
  const stage = app.crm_stage;
  const replyCount = app.reply_count ?? 0;
  const leadReply = lastMsg?.direction === "in" ? lastMsg.texto.toLowerCase() : "";

  // Negative tone
  if (/(caro|cara|n[aã]o tenho|sem tempo|depois|talvez|impossível|cancelar)/i.test(leadReply)) {
    return { text: "Contornar objeção", type: "qualify" };
  }
  // Engaged tone
  if (/(vamos|quero|fechar|proposta|sim|adorei|ótimo|otimo|demo|agendar)/i.test(leadReply)) {
    return { text: "Agendar diagnóstico", type: "meet" };
  }

  switch (stage) {
    case "novo":
      return { text: "Aguardando 1º contato", type: "wait" };
    case "contato_respondido_pela_ia":
      return { text: replyCount > 0 ? "Aguardando nova resposta" : "Aguardando resposta", type: "wait" };
    case "em_contato":
      if (replyCount >= 3) return { text: "Aprofundar qualificação", type: "qualify" };
      if (replyCount >= 1) return { text: "Qualificar perfil", type: "qualify" };
      return { text: "Retomar conversa", type: "send" };
    case "ligacao_agendada":
      return { text: "Ligar em breve", type: "call" };
    case "call_agendada":
      return {
        text: app.call_scheduled_at ? `Call ${formatTime(app.call_scheduled_at)}` : "Call agendada",
        type: "meet",
      };
    case "em_negociacao":
      return { text: "Enviar proposta comercial", type: "send" };
    case "ganho":
      return { text: "Onboarding iniciado", type: "done" };
    case "perdido":
      return { text: "Oportunidade perdida", type: "done" };
    case "descartado":
      return { text: "Não-fit confirmado", type: "done" };
    case "contato_futuro":
      return { text: "Reabordar em breve", type: "wait" };
    default:
      return { text: "", type: "wait" };
  }
}

/**
 * Returns sentiment: prefers the AI-classified value from applications.ai_sentiment
 * (set by the sentiment step using Gemini). Falls back to regex heuristic on
 * the latest message only if ai_sentiment is null (e.g., for leads created
 * before the sentiment step was wired up).
 */
function deriveSentiment(app: Application, lastMsg?: { texto: string; direction: "in" | "out" }): UiLead["sentiment"] {
  if (app.ai_sentiment === "positive" || app.ai_sentiment === "negative" || app.ai_sentiment === "neutral") {
    return app.ai_sentiment;
  }
  // Legacy fallback for leads without Gemini-classified sentiment yet
  const source = lastMsg?.direction === "in" ? lastMsg.texto : app.last_reply_text ?? "";
  if (!source) return "neutral";
  const txt = source.toLowerCase();
  if (/(não|nao|caro|pesado|impossível|sem tempo|cancelar|perdi)/i.test(txt)) return "negative";
  if (/(ótimo|otimo|legal|interessa|vamos|fechar|proposta|bora|adorei|perfeito|agendar|quero)/i.test(txt)) return "positive";
  return "neutral";
}

export function applicationToUiLead(app: Application, messageIdx?: MessageIndex): UiLead {
  const parsedFallback = parseNotesFallback(app.notes);
  const lastMsg = messageIdx?.[app.id];
  const nextAction = deriveNextAction(app, lastMsg);
  const sentiment = deriveSentiment(app, lastMsg);

  // role/company: prefer direct DB columns (set by AI via anotar_cargo/anotar_empresa),
  // fall back to legacy notes-parse for pre-migration leads.
  const role = app.role ?? parsedFallback.role ?? "";
  const company = app.company ?? parsedFallback.company ?? "";

  // Preview: prefer the most recent message (in or out), fallback to last_reply_text, then empty.
  let preview = "";
  let previewDir: "in" | "out" | null = null;
  let previewTime = "";
  if (lastMsg) {
    preview = lastMsg.texto;
    previewDir = lastMsg.direction;
    previewTime = formatTime(lastMsg.ts);
  } else if (app.last_reply_text) {
    preview = app.last_reply_text;
    previewDir = "in";
    previewTime = formatTime(app.replied_at);
  }

  return {
    id: app.id,
    stage: app.crm_stage,
    name: app.full_name || "Sem nome",
    company,
    role,
    phone: app.phone,
    email: app.email ?? "",
    assignee: deriveAssignee(app.crm_stage),
    aiScore: deriveScore(app),
    sentiment,
    nextAction: nextAction.text,
    nextActionType: nextAction.type,
    lastMessage: preview,
    lastMessageDirection: previewDir,
    lastMessageTime: previewTime,
    unread: app.reply_count || 0,
    createdAt: formatTime(app.created_at),
    signupDate: formatDate(app.created_at),
    aiSummary:
      app.qualification_notes ||
      app.notes ||
      `Lead em "${app.crm_stage}" — ${role || "perfil"} ${company ? `@ ${company}` : ""}`,
    aiPaused: Boolean(app.ai_paused),
    descarteMotivo: app.descarte_motivo ?? null,
  };
}

export type TeamMember = {
  id: string;
  name: string;
  initials: string;
  color: string;
  isAi?: boolean;
};

export const TEAM: TeamMember[] = [
  { id: "ai", name: "Assistente IA", initials: "IA", color: "#8b5cf6", isAi: true },
  { id: "closer", name: "Você", initials: "VC", color: "#2563eb" },
];

export const TEAM_BY_ID: Record<string, TeamMember> = Object.fromEntries(TEAM.map((m) => [m.id, m]));

export function formatValue(v: number): string {
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return `R$ ${v}`;
}
