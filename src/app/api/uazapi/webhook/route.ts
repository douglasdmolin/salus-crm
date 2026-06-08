import { NextRequest, NextResponse } from "next/server";
import { resumeHook } from "workflow/api";
import { createServiceClient } from "../../../../lib/supabase";
import { redactWhatsapp } from "../../../../lib/redact";
import { isPhoneAllowed, normalizeBrPhone } from "../../../../lib/phone-whitelist";

/**
 * Uazapi webhook — receives ALL WhatsApp messages for the instance (both directions).
 *
 * Strategy:
 * - `fromMe: false` (lead → us): look up application by phone, write to messages_received,
 *   resume the workflow hook so Carol can react (unless ai_paused).
 * - `fromMe: true` (us → lead): when sent from the phone directly (not via API),
 *   mirror into message_log as a human-sent outbound message AND auto-pause Carol.
 *   Messages sent via our API are already logged by the sendWhatsapp step, so they're
 *   filtered by the webhook's `excludeMessages: ["wasSentByApi"]` rule.
 */
export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const data = payload as {
    event?: string;
    message?: {
      id?: string;
      from?: string;
      fromMe?: boolean;
      body?: string;
      text?: string;
      timestamp?: number;
      chatid?: string;
      type?: string;
      wasSentByApi?: boolean;
    };
  };

  // Verbose log — see every webhook payload so we can diagnose what Uazapi actually sends
  console.log("uazapi.webhook: event received", {
    event: data.event,
    hasMessage: Boolean(data.message),
    fromMe: data.message?.fromMe,
    wasSentByApi: data.message?.wasSentByApi,
    from: data.message?.from?.slice(0, 20),
    chatid: data.message?.chatid?.slice(0, 20),
    type: data.message?.type,
    textLen: (data.message?.body ?? data.message?.text ?? "").length,
    topLevelKeys: Object.keys(data),
    messageKeys: data.message ? Object.keys(data.message) : [],
  });

  const msg = data.message;
  if (!msg) {
    return NextResponse.json({ ok: true, ignored: "no message" });
  }

  const whatsappRaw = msg.from ?? msg.chatid ?? "";
  const text = msg.body ?? msg.text ?? "";
  const uazapiId = msg.id ?? "";

  if (!whatsappRaw || !text) {
    return NextResponse.json({ ok: true, ignored: "missing from/text" });
  }

  const cleaned = whatsappRaw.includes("@") ? whatsappRaw.split("@")[0] : whatsappRaw;
  const digits = cleaned.replace(/\D/g, "");

  if (!isPhoneAllowed(digits)) {
    console.log("uazapi.webhook: phone not whitelisted, ignoring", { phone: redactWhatsapp(digits) });
    return NextResponse.json({ ok: true, ignored: "phone_not_whitelisted" });
  }

  const supabase = createServiceClient();

  // Idempotency
  if (uazapiId) {
    const { data: dup } = await supabase
      .from("processed_uazapi_crm_messages")
      .select("uazapi_id")
      .eq("uazapi_id", uazapiId)
      .maybeSingle();
    if (dup) {
      return NextResponse.json({ ok: true, ignored: "duplicate" });
    }
  }

  // Find active application by canonical phone — normalize both sides so formatted
  // phones like "(92) 98195-1096" match "5592981951096" regardless of storage format.
  const canonical = normalizeBrPhone(digits);

  const { data: candidates } = await supabase
    .from("applications")
    .select("id, crm_stage, workflow_run_id, hook_token, do_not_contact, phone, ai_paused, created_at")
    .eq("do_not_contact", false)
    // Terminais migration 002: fechamento, perdido, descartado
    // Terminais legados: ganho (mantido para compatibilidade)
    // Terminais canônicos: fechado, perdido, descartado
    // Terminais legados: fechamento, ganho (compatibilidade)
    .not("crm_stage", "in", "(fechado,perdido,descartado,fechamento,ganho)")
    .order("created_at", { ascending: false });

  const lead = (candidates ?? []).find((a) => normalizeBrPhone(a.phone) === canonical);
  if (!lead) {
    console.log("uazapi.webhook: no active lead", { phone: redactWhatsapp(digits), fromMe: msg.fromMe });
    return NextResponse.json({ ok: true, ignored: "no active lead" });
  }

  // Register idempotency
  if (uazapiId) {
    await supabase
      .from("processed_uazapi_crm_messages")
      .insert({ uazapi_id: uazapiId, application_id: lead.id })
      .throwOnError()
      .then(undefined, () => {});
  }

  // --- fromMe=true: user sent this from the phone directly (not from our CRM API) ---
  if (msg.fromMe) {
    // Skip if this came from our own API send (already logged by sendWhatsapp step)
    if (msg.wasSentByApi) {
      return NextResponse.json({ ok: true, ignored: "wasSentByApi" });
    }

    console.log("uazapi.webhook: human-from-phone outbound", { leadId: lead.id, len: text.length });
    // Mirror into message_log
    await supabase.from("message_log").insert({
      application_id: lead.id,
      numero_normalizado: digits,
      texto: text,
      http_status: 200,
      uazapi_response: { source: "phone_whatsapp_direct", uazapi_id: uazapiId } as Record<string, unknown>,
      status: "sent",
      error_reason: "human_sent_phone",
    });

    // Auto-pause Carol so she doesn't also respond
    if (!lead.ai_paused) {
      await supabase
        .from("applications")
        .update({ ai_paused: true, ai_paused_at: new Date().toISOString() })
        .eq("id", lead.id);
    }

    return NextResponse.json({ ok: true, mirrored: "human_from_phone" });
  }

  // --- fromMe=false: lead replied ---
  try {
    await supabase.from("messages_received").insert({
      application_id: lead.id,
      uazapi_message_id: uazapiId || `manual-${Date.now()}`,
      chatid: msg.chatid ?? whatsappRaw,
      numero: digits,
      texto: text,
      message_type: msg.type ?? "text",
      received_at: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
      raw_payload: data as Record<string, unknown>,
    });
  } catch (err) {
    console.warn("messages_received insert failed", String(err));
  }

  // Bump reply_count
  await supabase.rpc("increment_reply_count", { app_id: lead.id }).then(
    undefined,
    async () => {
      // RPC not defined — fallback plain update
      await supabase
        .from("applications")
        .update({
          replied_at: new Date().toISOString(),
          last_reply_text: text,
        })
        .eq("id", lead.id);
    }
  );

  // Resume workflow — usa hook_token único por run (evita rotear para workflow zumbi)
  const token = (lead as { hook_token?: string | null }).hook_token || `lead:${lead.id}:inbound`;
  try {
    await resumeHook(token, {
      text,
      timestamp: msg.timestamp ?? Date.now(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("resumeHook failed", { leadId: lead.id, token, err: String(err) });
    return NextResponse.json({ error: "resume failed" }, { status: 500 });
  }
}
