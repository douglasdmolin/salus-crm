import { RetryableError } from "workflow";
import { getUazapiConfig } from "../../lib/crm-config";
import { redactWhatsapp } from "../../lib/redact";
import { createServiceClient } from "../../lib/supabase";

const TYPING_DELAY_MS = 5_000;

/**
 * Normalizes Brazilian phone format to digits-only expected by Uazapi.
 * Accepts: "(11) 99988-7766", "+5511999887766", "11999887766", "5511999887766".
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return "55" + digits;
  if (digits.length === 13 && digits.startsWith("55")) return digits;
  if (digits.length >= 10) return digits.startsWith("55") ? digits : "55" + digits;
  return digits;
}

/**
 * Sends a WhatsApp message via Uazapi.
 * Throws RetryableError on 429/5xx (WDK retries automatically).
 * Logs every attempt to message_log INLINE (no nested step).
 */
export async function sendWhatsapp(leadId: string, message: string): Promise<string> {
  "use step";
  const uazapi = await getUazapiConfig();
  if (!uazapi) throw new Error("Uazapi não configurado — defina URL e Token nas Configurações do CRM");
  const supabase = createServiceClient();

  // Fetch lead directly (no step wrapping — we are inside a step already)
  const { data: lead, error: leadErr } = await supabase
    .from("applications")
    .select("id, phone, do_not_contact, full_name")
    .eq("id", leadId)
    .maybeSingle();

  if (leadErr || !lead) {
    console.error("sendWhatsapp: lead not found", { leadId, err: leadErr?.message });
    throw new Error(`Application ${leadId} not found: ${leadErr?.message ?? "no row"}`);
  }

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
  console.log("sendWhatsapp: composing", { leadId, phone: redactWhatsapp(phone), len: message.length });

  // 1) Show "digitando..." indicator to make it feel human.
  //    Fire-and-forget (don't fail send if this errors).
  try {
    await fetch(`${uazapi.url}/message/presence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: uazapi.token,
      },
      body: JSON.stringify({ number: phone, presence: "composing" }),
    });
  } catch (presenceErr) {
    console.warn("sendWhatsapp: presence indicator failed (non-fatal)", String(presenceErr));
  }

  // 2) Human-like delay so the message doesn't feel bot-fast.
  await new Promise((resolve) => setTimeout(resolve, TYPING_DELAY_MS));

  // 3) Send the actual message (also stops typing indicator automatically).
  let res: Response;
  try {
    res = await fetch(`${uazapi.url}/send/text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: uazapi.token,
      },
      body: JSON.stringify({ number: phone, text: message }),
    });
  } catch (fetchErr) {
    console.error("sendWhatsapp: fetch threw", String(fetchErr));
    await supabase.from("message_log").insert({
      application_id: leadId,
      numero_normalizado: phone,
      texto: message,
      http_status: 0,
      uazapi_response: { error: String(fetchErr) },
      status: "failed",
      error_reason: "fetch_exception",
    });
    throw new RetryableError("Uazapi fetch error", { retryAfter: "15s" });
  }

  let responseBody: unknown = null;
  try {
    responseBody = await res.json();
  } catch {
    responseBody = { raw: await res.text() };
  }

  console.log("sendWhatsapp: response", { status: res.status, idPresent: Boolean((responseBody as { id?: string; messageid?: string })?.id ?? (responseBody as { messageid?: string })?.messageid) });

  if (res.status === 429) {
    await supabase.from("message_log").insert({
      application_id: leadId,
      numero_normalizado: phone,
      texto: message,
      http_status: 429,
      uazapi_response: responseBody as Record<string, unknown>,
      status: "failed",
      error_reason: "rate_limited",
    });
    throw new RetryableError("Uazapi rate limited", { retryAfter: "30s" });
  }

  if (res.status >= 500 && res.status < 600) {
    await supabase.from("message_log").insert({
      application_id: leadId,
      numero_normalizado: phone,
      texto: message,
      http_status: res.status,
      uazapi_response: responseBody as Record<string, unknown>,
      status: "failed",
      error_reason: `http_${res.status}`,
    });
    throw new RetryableError(`Uazapi ${res.status}`, { retryAfter: "10s" });
  }

  if (!res.ok) {
    await supabase.from("message_log").insert({
      application_id: leadId,
      numero_normalizado: phone,
      texto: message,
      http_status: res.status,
      uazapi_response: responseBody as Record<string, unknown>,
      status: "failed",
      error_reason: `http_${res.status}`,
    });
    throw new Error(`Uazapi failed: ${res.status}`);
  }

  const data = responseBody as { id?: string; messageid?: string };
  const uazapiId: string = data?.id ?? data?.messageid ?? "unknown";

  const { error: logErr } = await supabase.from("message_log").insert({
    application_id: leadId,
    numero_normalizado: phone,
    texto: message,
    http_status: res.status,
    uazapi_response: responseBody as Record<string, unknown>,
    status: "sent",
    error_reason: null,
  });
  if (logErr) console.error("sendWhatsapp: log insert failed", logErr.message);

  console.log("sendWhatsapp: done", { leadId, uazapiId });
  return uazapiId;
}
