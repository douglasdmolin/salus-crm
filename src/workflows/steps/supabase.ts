import {
  createServiceClient,
  type Application,
  type CrmStage,
  type ConversationMessage,
} from "../../lib/supabase";

/**
 * Fetches a lead (application) by ID for workflow use.
 * @param leadId Application UUID
 */
export async function getLead(leadId: string): Promise<Application | null> {
  "use step";
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (error) {
    console.error("getLead error", { leadId, code: error.code });
    return null;
  }
  return data as Application | null;
}

/**
 * Updates crm_stage + optional patch on applications.
 * `updated_at` is set via DB trigger.
 */
export async function updateLeadStatus(
  leadId: string,
  crmStage: CrmStage,
  patch: Record<string, unknown> = {}
): Promise<void> {
  "use step";
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("applications")
    .update({ crm_stage: crmStage, ...patch })
    .eq("id", leadId);
  if (error) throw new Error(`updateLeadStatus failed: ${error.message}`);
}

/**
 * Logs an outbound message to message_log (mirrors the OSINT scorer's convention).
 * Inbound messages come from messages_received (written by the webhook endpoint).
 */
export async function logOutboundMessage(
  leadId: string,
  phone: string,
  texto: string,
  httpStatus: number,
  uazapiResponse: unknown,
  statusLabel: "sent" | "failed",
  errorReason?: string
): Promise<void> {
  "use step";
  const supabase = createServiceClient();
  await supabase.from("message_log").insert({
    application_id: leadId,
    numero_normalizado: phone,
    texto,
    http_status: httpStatus,
    uazapi_response: (uazapiResponse ?? {}) as Record<string, unknown>,
    status: statusLabel,
    error_reason: errorReason ?? null,
  });
}

/**
 * Builds conversation history from both tables (messages_received + message_log).
 * Returns chronologically ordered messages for LLM context.
 */
export async function getConversationHistory(leadId: string): Promise<ConversationMessage[]> {
  "use step";
  const supabase = createServiceClient();

  const [{ data: inbound }, { data: outbound }] = await Promise.all([
    supabase
      .from("messages_received")
      .select("texto, received_at")
      .eq("application_id", leadId)
      .order("received_at", { ascending: true }),
    supabase
      .from("message_log")
      .select("texto, attempted_at, status")
      .eq("application_id", leadId)
      .eq("status", "sent")
      .order("attempted_at", { ascending: true }),
  ]);

  const messages: ConversationMessage[] = [];
  for (const m of inbound ?? []) {
    if (m.texto) messages.push({ direction: "in", content: m.texto, created_at: m.received_at });
  }
  for (const m of outbound ?? []) {
    if (m.texto) messages.push({ direction: "out", content: m.texto, created_at: m.attempted_at });
  }
  messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return messages;
}
