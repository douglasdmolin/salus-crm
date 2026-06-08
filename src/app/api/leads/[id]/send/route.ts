import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase";
import { getUazapiConfig } from "../../../../../lib/crm-config";
import { isPhoneAllowed } from "../../../../../lib/phone-whitelist";

/**
 * Allows a human operator to send a WhatsApp message directly from the CRM.
 * Does NOT go through the Workflow DevKit — direct Uazapi call.
 * Records the send in message_log with status='sent' and error_reason='human_sent'
 * so it's easy to distinguish from Carol's messages in analytics later.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const [uazapi, { id: leadId }] = await Promise.all([getUazapiConfig(), params]);
  if (!uazapi) {
    return NextResponse.json({ error: "Uazapi não configurado — defina URL e Token nas Configurações do CRM" }, { status: 503 });
  }

  let body: { texto?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const texto = (body.texto ?? "").trim();
  if (!texto) {
    return NextResponse.json({ error: "texto required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: lead, error: leadErr } = await supabase
    .from("applications")
    .select("id, phone, do_not_contact, full_name")
    .eq("id", leadId)
    .maybeSingle();

  if (leadErr || !lead) {
    return NextResponse.json({ error: "lead not found" }, { status: 404 });
  }
  if (lead.do_not_contact) {
    return NextResponse.json({ error: "do_not_contact set" }, { status: 403 });
  }
  if (!isPhoneAllowed(lead.phone)) {
    return NextResponse.json({ error: "phone not whitelisted" }, { status: 403 });
  }

  // Normalize phone (digits only with 55 prefix)
  const digits = lead.phone.replace(/\D/g, "");
  const phone = digits.length === 11 ? "55" + digits : digits.startsWith("55") ? digits : "55" + digits;

  // 1) Typing indicator (fire-and-forget)
  fetch(`${uazapi.url}/message/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: uazapi.token },
    body: JSON.stringify({ number: phone, presence: "composing" }),
  }).catch(() => {});

  // 2) Short human delay to make the typing indicator visible (1s)
  await new Promise((r) => setTimeout(r, 1000));

  // 3) Send
  let res: Response;
  try {
    res = await fetch(`${uazapi.url}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: uazapi.token },
      body: JSON.stringify({ number: phone, text: texto }),
    });
  } catch (err) {
    await supabase.from("message_log").insert({
      application_id: leadId,
      numero_normalizado: phone,
      texto,
      http_status: 0,
      uazapi_response: { error: String(err) },
      status: "failed",
      error_reason: "human_send_fetch_error",
    });
    return NextResponse.json({ error: "uazapi fetch failed" }, { status: 502 });
  }

  let responseBody: unknown = null;
  try {
    responseBody = await res.json();
  } catch {
    responseBody = { raw: await res.text() };
  }

  const isOk = res.ok;
  await supabase.from("message_log").insert({
    application_id: leadId,
    numero_normalizado: phone,
    texto,
    http_status: res.status,
    uazapi_response: responseBody as Record<string, unknown>,
    status: isOk ? "sent" : "failed",
    error_reason: isOk ? "human_sent_crm" : `http_${res.status}`,
  });

  if (!isOk) {
    return NextResponse.json({ error: `uazapi ${res.status}` }, { status: 502 });
  }

  // Auto-pause Carol — human has taken over from the CRM
  await supabase
    .from("applications")
    .update({ ai_paused: true, ai_paused_at: new Date().toISOString() })
    .eq("id", leadId)
    .then(undefined, (err) => console.warn("auto-pause failed", err));

  return NextResponse.json({ ok: true, ai_paused: true });
}
