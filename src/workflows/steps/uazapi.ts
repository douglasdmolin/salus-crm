import { RetryableError } from "workflow";
import { getWhatsappConfig } from "../../lib/crm-config";
import { redactWhatsapp } from "../../lib/redact";
import { createServiceClient } from "../../lib/supabase";
import { getAdapter, normalizePhone } from "../../lib/whatsapp";

const TYPING_DELAY_MS = 5_000;

/**
 * Sends a WhatsApp message via the lead's provider (uazapi | evolution).
 * Throws RetryableError on 429/5xx (WDK retries automatically).
 * Logs every attempt to message_log INLINE (no nested step).
 */
export async function sendWhatsapp(leadId: string, message: string): Promise<string> {
  "use step";
  const supabase = createServiceClient();

  // Busca o lead primeiro — precisamos do whatsapp_instance_id para escolher o número/provider de envio.
  const { data: lead, error: leadErr } = await supabase
    .from("applications")
    .select("id, phone, do_not_contact, full_name, whatsapp_instance_id")
    .eq("id", leadId)
    .maybeSingle();

  if (leadErr || !lead) {
    console.error("sendWhatsapp: lead not found", { leadId, err: leadErr?.message });
    throw new Error(`Application ${leadId} not found: ${leadErr?.message ?? "no row"}`);
  }

  // Resolve a instância do lead (multi-número/multi-provider). Sem instância → config global.
  const cfg = await getWhatsappConfig((lead as { whatsapp_instance_id?: string | null }).whatsapp_instance_id);
  if (!cfg) throw new Error("WhatsApp não configurado — defina URL e Token nas Configurações do CRM");
  const adapter = getAdapter(cfg.provider);

  if (lead.do_not_contact) {
    console.log("sendWhatsapp: skipped (do_not_contact)", { leadId });
    await supabase.from("message_log").insert({
      application_id: leadId,
      numero_normalizado: lead.phone,
      texto: message,
      http_status: 0,
      uazapi_response: null,
      status: "failed",
      error_reason: "do_not_contact",
    });
    return "do-not-contact";
  }

  const phone = normalizePhone(lead.phone);
  console.log("sendWhatsapp: composing", { leadId, provider: cfg.provider, phone: redactWhatsapp(phone), len: message.length });

  // 1) Show "digitando..." indicator to make it feel human. Fire-and-forget.
  try {
    await adapter.sendPresence(cfg, phone);
  } catch (presenceErr) {
    console.warn("sendWhatsapp: presence indicator failed (non-fatal)", String(presenceErr));
  }

  // 2) Human-like delay so the message doesn't feel bot-fast.
  await new Promise((resolve) => setTimeout(resolve, TYPING_DELAY_MS));

  // 3) Send the actual message (also stops typing indicator automatically).
  const result = await adapter.sendText(cfg, phone, message);

  console.log("sendWhatsapp: response", { provider: cfg.provider, status: result.httpStatus, idPresent: Boolean(result.messageId) });

  if (!result.ok) {
    await supabase.from("message_log").insert({
      application_id: leadId,
      numero_normalizado: phone,
      texto: message,
      http_status: result.httpStatus,
      uazapi_response: result.raw as Record<string, unknown>,
      status: "failed",
      error_reason: result.errorReason ?? `http_${result.httpStatus}`,
    });
    // 429/5xx/erro de rede → retryável; demais falhas → erro definitivo.
    if (result.retryAfter) {
      throw new RetryableError(`WhatsApp ${cfg.provider} ${result.errorReason ?? result.httpStatus}`, { retryAfter: result.retryAfter });
    }
    throw new Error(`WhatsApp ${cfg.provider} failed: ${result.httpStatus}`);
  }

  const messageId = result.messageId ?? "unknown";

  const { error: logErr } = await supabase.from("message_log").insert({
    application_id: leadId,
    numero_normalizado: phone,
    texto: message,
    http_status: result.httpStatus,
    uazapi_response: result.raw as Record<string, unknown>,
    status: "sent",
    error_reason: null,
  });
  if (logErr) console.error("sendWhatsapp: log insert failed", logErr.message);

  // Evolution não sinaliza no webhook que a mensagem saiu da nossa API (não tem
  // wasSentByApi). Gravamos o id enviado na tabela de idempotência para que o webhook
  // Evolution pule o eco fromMe desta mesma mensagem (evita mirror + auto-pause indevido).
  if (cfg.provider === "evolution" && result.messageId) {
    await supabase
      .from("processed_uazapi_crm_messages")
      .insert({ uazapi_id: result.messageId, application_id: leadId })
      .then(undefined, () => {});
  }

  console.log("sendWhatsapp: done", { leadId, provider: cfg.provider, messageId });
  return messageId;
}
