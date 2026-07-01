import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase";
import { getWhatsappConfig } from "../../../../../lib/crm-config";
import { isPhoneAllowed } from "../../../../../lib/phone-whitelist";
import { getAdapter, normalizePhone } from "../../../../../lib/whatsapp";

/**
 * Allows a human operator to send a WhatsApp message directly from the CRM.
 * Does NOT go through the Workflow DevKit — direct provider call via adapter.
 * Records the send in message_log with status='sent' and error_reason='human_sent_crm'
 * so it's easy to distinguish from Carol's messages in analytics later.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;

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
    .select("id, phone, do_not_contact, full_name, whatsapp_instance_id")
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

  // Provider/credenciais do número dono do lead (multi-número/multi-provider).
  const cfg = await getWhatsappConfig((lead as { whatsapp_instance_id?: string | null }).whatsapp_instance_id);
  if (!cfg) {
    return NextResponse.json({ error: "WhatsApp não configurado — defina URL e Token nas Configurações do CRM" }, { status: 503 });
  }
  const adapter = getAdapter(cfg.provider);

  const phone = normalizePhone(lead.phone);

  // 1) Typing indicator (fire-and-forget)
  adapter.sendPresence(cfg, phone).catch(() => {});
  // 2) Short human delay to make the typing indicator visible (1s)
  await new Promise((r) => setTimeout(r, 1000));
  // 3) Send
  const result = await adapter.sendText(cfg, phone, texto);

  await supabase.from("message_log").insert({
    application_id: leadId,
    numero_normalizado: phone,
    texto,
    http_status: result.httpStatus,
    uazapi_response: result.raw as Record<string, unknown>,
    status: result.ok ? "sent" : "failed",
    error_reason: result.ok ? "human_sent_crm" : (result.errorReason ?? `http_${result.httpStatus}`),
  });

  if (!result.ok) {
    return NextResponse.json({ error: `whatsapp ${cfg.provider} ${result.httpStatus}` }, { status: 502 });
  }

  // Evolution: grava o id enviado p/ o webhook pular o eco fromMe desta mensagem.
  if (cfg.provider === "evolution" && result.messageId) {
    await supabase
      .from("processed_uazapi_crm_messages")
      .insert({ uazapi_id: result.messageId, application_id: leadId })
      .then(undefined, () => {});
  }

  // Auto-pause Carol — human has taken over from the CRM
  await supabase
    .from("applications")
    .update({ ai_paused: true, ai_paused_at: new Date().toISOString() })
    .eq("id", leadId)
    .then(undefined, (err) => console.warn("auto-pause failed", err));

  return NextResponse.json({ ok: true, ai_paused: true });
}
