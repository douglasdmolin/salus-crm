import type { UiLead } from "./ui-lead";

/**
 * Map of UI fields → their data source (DB column, derivation logic, or hardcoded origin).
 *
 * When "Debug fontes" tweak is ON, the LeadCard + ChatModal replace values with these strings
 * so operators can audit what's real DB data vs derived vs hardcoded/mocked.
 *
 * Legend:
 *   📊 = direct DB column
 *   🔄 = derived from DB + logic (src/components/crm/ui-lead.ts)
 *   ⚠️ = hardcoded or mocked (potential technical debt)
 *   🔗 = join / denormalized from another table
 *
 * POLICY (enforced at compile time via `satisfies` below):
 * Any new field added to `UiLead` MUST appear here with a one-line data-source string,
 * AND get a full FieldExplanation entry in `debug-explanations.ts` (SECTIONS array).
 * The build breaks if a UiLead field is missing from DEBUG_SOURCES.
 */
export const DEBUG_SOURCES = {
  // UiLead core identity (from applications table)
  id: "📊 applications.id",
  stage: "📊 applications.crm_stage",
  name: "📊 applications.full_name",
  phone: "📊 applications.phone",
  email: "📊 applications.email",
  unread: "📊 applications.reply_count",
  aiPaused: "📊 applications.ai_paused",
  workflowRunId: "📊 applications.workflow_run_id",
  createdAtRaw: "📊 applications.created_at",
  updatedAtRaw: "📊 applications.updated_at",

  // Captured by AI via anotar_cargo / anotar_empresa tools
  company: "📊 applications.company (captado pela IA via tool 'anotar_empresa')",
  role: "📊 applications.role (captado pela IA via tool 'anotar_cargo')",
  origem: "⚙️ próxima versão — todas marcadas como 'formulário' por ora",

  // Derived from applications columns + fallback logic (ui-lead.ts)
  aiScore: "🔄 applications.enrichment_score || deriveScore(crm_stage, reply_count) — UI mostra como 'Score IA — em breve' (OSINT atual é gambiarra)",
  aiScoreLabel: "🔄 aiScore → 'Alta' (≥75) | 'Média' (≥50) | 'Baixa' — escondido por ora",
  descarteMotivo: "📊 applications.descarte_motivo (preenchido em backfill bucket-based ou pela tool 'descartar_lead' da Carol)",
  leadTags: "📊 applications.lead_tags (JSONB array — tags coletadas pela tool registrar_tag durante conversas)",
  sentiment: "📊 applications.ai_sentiment (classificado por Gemini 2.5 Flash Lite após cada msg inbound)",
  nextAction: "🔄 derive(crm_stage, reply_count, last inbound text)",
  nextActionType: "🔄 mapped from crm_stage",
  assignee: "🔄 'ai' if ia-owned stage else 'closer'",
  assigneeIsAi: "🔄 derived from assignee",
  aiSummary: "🔄 applications.qualification_notes || applications.notes || template",

  // Time formatting
  createdAt: "🔄 formatTime(applications.created_at) — relative ('agora', '5min', '3d')",
  signupDate: "🔄 formatDate(applications.created_at) — absolute dd/MM/yyyy",
  lastMessageTime: "🔄 formatTime(max(msg recv_at, msg attempted_at, applications.updated_at))",

  // Joined from message tables
  lastMessage: "🔗 messages_received.texto OR message_log.texto (most recent by ts)",
  lastMessageDirection: "🔗 derived (in = messages_received, out = message_log)",
  conversationHistory: "🔗 JOIN messages_received + message_log ORDER BY ts",

  tags: "⚙️ próxima versão — sistema de tags virá em breve",

  // Msg bubble attributes
  msgAuthorAi: "🔗 message_log.error_reason NOT IN ('human_sent_crm','human_sent_phone')",
  msgAuthorHuman: "🔗 message_log.error_reason IN ('human_sent_crm','human_sent_phone')",
  msgAuthorLead: "🔗 from messages_received table",

  // AI persona
  iaPersonaName: "⚙️ const IA_PERSONA_NAME in src/workflows/prompts/carol-v1.ts",

  // Derived config
  teamAi: "⚙️ TEAM const in ui-lead.ts → { id: 'ai', name: 'Assistente IA' }",
  teamCloser: "⚙️ TEAM const in ui-lead.ts → { id: 'closer', name: 'Você' }",
} as const satisfies Record<keyof UiLead, string> & Record<string, string>;

/**
 * Compile-time guard: if any new UiLead field is missing from DEBUG_SOURCES,
 * TypeScript will fail with "Type '...' is not assignable to type 'never'".
 *
 * Extend DEBUG_SOURCES AND add a corresponding section to `debug-explanations.ts`
 * whenever you add a column to `applications` surfaced in the CRM.
 */
type _UiLeadCoverageCheck = Exclude<keyof UiLead, keyof typeof DEBUG_SOURCES> extends never
  ? true
  : `Missing DEBUG_SOURCES entry for UiLead field(s): ${Exclude<keyof UiLead, keyof typeof DEBUG_SOURCES> & string}`;
const _uiLeadCoverageOk: _UiLeadCoverageCheck = true;
void _uiLeadCoverageOk;
