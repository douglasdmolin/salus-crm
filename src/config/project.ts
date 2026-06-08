/**
 * ═════════════════════════════════════════════════════════════
 *  PROJECT CONFIG — edit this file to brand the CRM for a new client.
 *  Every value here is static (compile-time). For runtime values (AI
 *  prompt, model, dispatch interval, etc), edit them in the /crm/config
 *  UI after deploy — those live in the `crm_config` DB table.
 * ═════════════════════════════════════════════════════════════
 */

export const PROJECT = {
  // Shown in the CRM header.
  name: "SALUS CRM",
  tagline: "Água que transforma.",

  // Shown as WhatsApp persona name (e.g., "Oi Fulano, aqui é a Jéssica da Salus...")
  iaPersonaName: "Sofia",

  // Used by the AI prompt template ({{BRAND_NAME}} replaced at runtime).
  brandName: "Salus",

  // Main CTA label shown on empty kanban etc.
  mainCtaLabel: "Novo lead",
} as const;

/**
 * Kanban columns. Each id must match a value in the `crm_stage` enum in
 * supabase/schema.sql. To add a new stage: (1) add here, (2) add to enum in SQL,
 * (3) run migration.
 *
 * `owner: "ia"` = stage where Carol (AI) responds automatically.
 * `owner: "human"` = stage where AI is paused (operator takes over).
 */
export type StageId = string;

export type StageConfig = {
  id: string;
  label: string;
  short: string;
  color: string;
  description: string;
  owner: "ia" | "human";
  position?: number;
  is_active?: boolean;
};

/** Fallback estático usado apenas como skeleton de loading — fonte real é a tabela kanban_stages */
export const STAGES_FALLBACK: StageConfig[] = [
  { id: "novo",                       label: "Novo",               short: "Novo",    color: "#94a3b8", description: "Acabou de cadastrar",         owner: "ia",    position: 0 },
  { id: "contato_respondido_pela_ia", label: "Respondido pela IA", short: "IA",      color: "#8b5cf6", description: "Primeiro contato automático", owner: "ia",    position: 1 },
  { id: "em_contato",                 label: "Em contato",         short: "Contato", color: "#06b6d4", description: "Qualificação em andamento",   owner: "ia",    position: 2 },
  { id: "ligacao_agendada",           label: "Ligação agendada",   short: "Ligação", color: "#0ea5e9", description: "Ligação marcada",             owner: "human", position: 3 },
  { id: "call_agendada",              label: "Call agendada",      short: "Call",    color: "#2563eb", description: "Videochamada marcada",        owner: "human", position: 4 },
  { id: "em_negociacao",              label: "Em negociação",      short: "Nego.",   color: "#d97706", description: "Proposta em andamento",       owner: "human", position: 5 },
  { id: "ganho",                      label: "Ganho",              short: "Ganho",   color: "#16a34a", description: "Fechado",                     owner: "human", position: 6 },
  { id: "perdido",                    label: "Perdido",            short: "Perdido", color: "#dc2626", description: "Oportunidade perdida",        owner: "human", position: 7 },
  { id: "descartado",                 label: "Descartado",         short: "Descart.",color: "#94a3b8", description: "Não-fit",                     owner: "ia",    position: 8 },
  { id: "contato_futuro",             label: "Contato futuro",     short: "Futuro",  color: "#64748b", description: "Reabordar",                   owner: "ia",    position: 9 },
];

/**
 * Default AI prompt template (what you edit in /crm/config UI at runtime).
 * Placeholders:
 *   {{IA_NAME}}       → PROJECT.iaPersonaName
 *   {{BRAND_NAME}}    → PROJECT.brandName
 *   {{LEAD_CONTEXT}}  → runtime lead data
 *
 * This is the FALLBACK — overrideable at runtime by editing /crm/config.
 */
export const DEFAULT_AI_PROMPT_TEMPLATE = `Você é a {{IA_NAME}}, assistente da {{BRAND_NAME}}.

SEU PAPEL:
Qualificar e acompanhar leads interessados. Tom caloroso, humano, sem script. Nunca revele que é IA.
Você opera em etapas — o prompt da etapa atual define seu objetivo específico.

REGRAS GLOBAIS (valem em QUALQUER etapa):
- SEMPRE use a tool "responder" para enviar mensagens ao lead
- Uma pergunta por vez — nunca formulário
- Nunca prometa preço ou detalhes técnicos complexos
- Nunca revele que é IA

TRANSIÇÕES UNIVERSAIS (disponíveis em qualquer etapa):
- mover_para_objecao   → use SEMPRE que o lead levantar barreira comercial, independente da etapa atual
                         ("é caro?", "não tenho tempo", "preciso falar com esposo/a", "já tenho filtro")
- agendar_retorno      → use SEMPRE que lead pedir para falar em data específica futura
                         ("me liga depois do dia 13", "só semana que vem", "me chama em julho")
                         Temporal NÃO é objeção — vai direto para Contato Futuro com a data registrada.
- register_opt_out     → SEMPRE que lead pedir para parar de receber mensagens
- archive_lead         → SEMPRE que lead recusar definitivamente ou for não-fit claro
- escalar_para_humano  → SEMPRE que situação estiver fora do seu escopo

{{LEAD_CONTEXT}}`;
