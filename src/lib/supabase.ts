import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./env";

// Server-side only — uses service_role
export function createServiceClient() {
  const env = getEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Client-side — uses anon key + RLS
export function createBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Application é a entidade "lead" na DB existente da {{BRAND_NAME}}.
 * O CRM usa `crm_stage` (enum novo) para seu pipeline, complementar aos
 * campos `status` (nova/approved/...) e `pipeline_status` (intake/enriching/...)
 * já presentes para o fluxo OSINT de enrichment.
 */
export type Application = {
  id: string;
  created_at: string;
  updated_at: string | null;

  // Identidade
  full_name: string;
  phone: string;
  email: string | null;
  birth_date: string | null;

  // Revisão (legado)
  status: string | null;
  assigned_to: string | null;
  notes: string | null;
  contact_date: string | null;
  scheduled_date: string | null;
  approach_copy: string | null;
  deleted_at: string | null;

  // OSINT enrichment (legado)
  pipeline_status: string | null;
  enriched_at: string | null;
  enrichment_score: number | null;
  enrichment_tier: string | null;
  enrichment_confidence: number | null;
  enrichment_flags: Record<string, unknown> | null;

  // WhatsApp (legado)
  do_not_contact: boolean;
  message_status: string | null;
  message_sent_at: string | null;
  whatsapp_chatid: string | null;
  whatsapp_messageid: string | null;
  replied_at: string | null;
  last_reply_text: string | null;
  reply_count: number;

  // CRM Carol (novo)
  crm_stage: CrmStage;
  workflow_run_id: string | null;
  reengage_at: string | null;
  call_link: string | null;
  call_scheduled_at: string | null;
  qualification_notes: string | null;
  ai_paused: boolean;
  ai_paused_at: string | null;

  // Captured by AI during conversation
  role: string | null;
  company: string | null;

  // AI-classified sentiment from latest message
  ai_sentiment: "positive" | "neutral" | "negative" | null;
  ai_sentiment_at: string | null;

  // Justificativa do descarte (preenchida quando crm_stage='descartado')
  descarte_motivo: string | null;

  // Tags coletadas em tempo real durante conversas (migration 016)
  lead_tags: LeadTag[];

  // Campos do schema Salus leads (migration 005)
  id_unico: string | null;
  nome_para_mensagem: string | null;
  mensagem_sugerida: string | null;
  contexto: string | null;
  abertura_awareness: string | null;
  ciclo_nutricao: string | null;
  score_prioridade: number | null;
  tier: number | null;
  zip_bairro: string | null;
};

/** Stage ID — any text value referencing kanban_stages.id */
export type CrmStage = string;

/**
 * Tag coletada em tempo real durante a conversa.
 * Categorias fixas para organização; tag em texto livre para descoberta orgânica de ICPs.
 */
export type LeadTag = {
  tag: string;
  categoria: "imovel" | "familia" | "dor" | "decisao" | "icp" | "sinal";
  valor?: string;
  set_at: string;
};

export type KanbanStage = {
  id: string;
  label: string;
  short: string;
  color: string;
  description: string;
  owner: "ia" | "human";
  position: number;
  is_active: boolean;
  created_at: string;
  system_prompt: string | null;
  ai_model: string | null;
  ai_enabled: boolean;
};

/** Log de mensagens enviadas — tabela existente (direção "out") */
export type MessageLog = {
  id: string;
  application_id: string | null;
  attempted_at: string;
  numero_normalizado: string;
  texto: string;
  http_status: number | null;
  uazapi_response: Record<string, unknown> | null;
  status: string;
  error_reason: string | null;
};

/** Log de mensagens recebidas — tabela existente (direção "in") */
export type MessageReceived = {
  id: string;
  application_id: string | null;
  uazapi_message_id: string;
  chatid: string;
  numero: string | null;
  texto: string | null;
  message_type: string | null;
  received_at: string;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
};

/** Unified message model para UI (combina in/out em timeline) */
export type ConversationMessage = {
  direction: "in" | "out";
  content: string;
  created_at: string;
};
