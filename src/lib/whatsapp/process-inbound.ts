import { randomUUID } from "crypto";
import { resumeHook, start } from "workflow/api";
import { leadQualificationWorkflow } from "../../workflows/lead-qualification";
import { createServiceClient } from "../supabase";
import { redactWhatsapp } from "../redact";
import { isPhoneAllowed, normalizeBrPhone } from "../phone-whitelist";
import type { NormalizedInbound } from "./types";

export type InboundResult = { status: number; body: Record<string, unknown> };

/**
 * Processa uma mensagem de entrada JÁ NORMALIZADA, independente da plataforma (uazapi
 * ou Evolution). Contém toda a regra de negócio que antes vivia no route do uazapi:
 * grupo, whitelist, idempotência, criação de lead inbound, espelhamento de outbound
 * manual (fromMe), messages_received, increment_reply_count e restart/resume do workflow.
 *
 * Mantém o mesmo comportamento observável — os dois webhooks (uazapi e evolution) apenas
 * fazem o parse do seu payload e delegam aqui.
 */
export async function handleInbound(n: NormalizedInbound): Promise<InboundResult> {
  // Ignora mensagens de grupo — nunca criar/responder lead a partir de um grupo.
  if (n.isGroup) {
    return { status: 200, body: { ok: true, ignored: "group message" } };
  }

  const digits = n.fromDigits;
  const text = n.text;
  const messageId = n.messageId;

  if (!digits || !text) {
    return { status: 200, body: { ok: true, ignored: "missing from/text" } };
  }

  if (!isPhoneAllowed(digits)) {
    console.log("whatsapp.inbound: phone not whitelisted, ignoring", { phone: redactWhatsapp(digits) });
    return { status: 200, body: { ok: true, ignored: "phone_not_whitelisted" } };
  }

  const supabase = createServiceClient();

  // Idempotência
  if (messageId) {
    const { data: dup } = await supabase
      .from("processed_uazapi_crm_messages")
      .select("uazapi_id")
      .eq("uazapi_id", messageId)
      .maybeSingle();
    if (dup) {
      return { status: 200, body: { ok: true, ignored: "duplicate" } };
    }
  }

  // Find active application by canonical phone — normalize both sides so formatted
  // phones like "(92) 98195-1096" match "5592981951096" regardless of storage format.
  const canonical = normalizeBrPhone(digits);

  const { data: candidates } = await supabase
    .from("applications")
    .select("id, crm_stage, workflow_run_id, hook_token, do_not_contact, phone, ai_paused, created_at")
    .eq("do_not_contact", false)
    .not("crm_stage", "in", "(fechado,perdido,descartado,fechamento,ganho)")
    .order("created_at", { ascending: false });

  const lead = (candidates ?? []).find((a) => normalizeBrPhone(a.phone) === canonical);

  if (!lead) {
    // Número desconhecido. Mensagem de ENTRADA (lead → nós) cria o lead e deixa a Sofia
    // responder automaticamente. fromMe=true sem lead = saída manual pra fora do CRM → ignora.
    if (n.fromMe) {
      console.log("whatsapp.inbound: no active lead (fromMe outbound) — ignoring", { phone: redactWhatsapp(digits) });
      return { status: 200, body: { ok: true, ignored: "no active lead (fromMe)" } };
    }

    const phoneE164 = `+${digits}`;
    const senderName = (n.senderName ?? "").trim() || `Contato WhatsApp ${digits.slice(-4)}`;
    const newToken = `lead:inbound:${randomUUID()}`;

    const { data: created, error: createErr } = await supabase
      .from("applications")
      .insert({
        full_name: senderName,
        nome_para_mensagem: senderName.split(" ")[0],
        phone: phoneE164,
        crm_stage: "respondeu",
        do_not_contact: false,
        reply_count: 0,
        hook_token: newToken,
        qualification_notes: JSON.stringify({ origem_principal: "inbound_whatsapp" }),
        whatsapp_instance_id: n.receivingInstanceId,
      })
      .select("id")
      .single();

    if (createErr || !created) {
      console.error("whatsapp.inbound: failed to create inbound lead", { phone: redactWhatsapp(digits), err: createErr?.message });
      return { status: 500, body: { error: "create lead failed" } };
    }
    const newLeadId = created.id as string;

    if (messageId) {
      await supabase.from("processed_uazapi_crm_messages")
        .insert({ uazapi_id: messageId, application_id: newLeadId })
        .then(undefined, () => {});
    }
    await supabase.from("messages_received").insert({
      application_id: newLeadId,
      uazapi_message_id: messageId || `manual-${Date.now()}`,
      chatid: n.chatId,
      numero: digits,
      texto: text,
      message_type: n.messageType,
      received_at: new Date(n.timestampMs).toISOString(),
      raw_payload: n.raw as Record<string, unknown>,
    }).then(undefined, (err) => console.warn("messages_received insert failed (new inbound lead)", String(err)));

    await supabase.rpc("increment_reply_count", { app_id: newLeadId }).then(
      undefined,
      async () => {
        await supabase.from("applications")
          .update({ replied_at: new Date().toISOString(), last_reply_text: text })
          .eq("id", newLeadId);
      },
    );

    try {
      const run = await start(leadQualificationWorkflow, [newLeadId, newToken]);
      await supabase.from("applications").update({ workflow_run_id: run.runId }).eq("id", newLeadId);
      console.log("whatsapp.inbound: created inbound lead + started workflow", { newLeadId, name: senderName, runId: run.runId });
      return { status: 200, body: { ok: true, created: true, leadId: newLeadId } };
    } catch (err) {
      console.error("whatsapp.inbound: start workflow failed for inbound lead", { newLeadId, err: String(err) });
      return { status: 500, body: { error: "start workflow failed" } };
    }
  }

  // Register idempotency
  if (messageId) {
    await supabase
      .from("processed_uazapi_crm_messages")
      .insert({ uazapi_id: messageId, application_id: lead.id })
      .throwOnError()
      .then(undefined, () => {});
  }

  // --- fromMe=true: user sent this from the phone directly (not from our CRM API) ---
  if (n.fromMe) {
    // Skip if this came from our own API send (already logged by sendWhatsapp step).
    // uazapi sinaliza via wasSentByApi; Evolution via messageId já gravado em processed.
    if (n.wasSentByApi) {
      return { status: 200, body: { ok: true, ignored: "wasSentByApi" } };
    }

    console.log("whatsapp.inbound: human-from-phone outbound", { leadId: lead.id, len: text.length });
    await supabase.from("message_log").insert({
      application_id: lead.id,
      numero_normalizado: digits,
      texto: text,
      http_status: 200,
      uazapi_response: { source: "phone_whatsapp_direct", uazapi_id: messageId } as Record<string, unknown>,
      status: "sent",
      error_reason: "human_sent_phone",
    });

    if (!lead.ai_paused) {
      await supabase
        .from("applications")
        .update({ ai_paused: true, ai_paused_at: new Date().toISOString() })
        .eq("id", lead.id);
    }

    return { status: 200, body: { ok: true, mirrored: "human_from_phone" } };
  }

  // --- fromMe=false: lead replied ---
  try {
    await supabase.from("messages_received").insert({
      application_id: lead.id,
      uazapi_message_id: messageId || `manual-${Date.now()}`,
      chatid: n.chatId,
      numero: digits,
      texto: text,
      message_type: n.messageType,
      received_at: new Date(n.timestampMs).toISOString(),
      raw_payload: n.raw as Record<string, unknown>,
    });
  } catch (err) {
    console.warn("messages_received insert failed", String(err));
  }

  await supabase.rpc("increment_reply_count", { app_id: lead.id }).then(
    undefined,
    async () => {
      await supabase
        .from("applications")
        .update({ replied_at: new Date().toISOString(), last_reply_text: text })
        .eq("id", lead.id);
    },
  );

  const activeLead = lead;
  async function restartWorkflow(): Promise<void> {
    const newToken = `lead:${activeLead.id}:inbound:${randomUUID()}`;
    await supabase
      .from("applications")
      .update({ hook_token: newToken, workflow_run_id: null })
      .eq("id", activeLead.id);
    const run = await start(leadQualificationWorkflow, [activeLead.id, newToken]);
    await supabase
      .from("applications")
      .update({ workflow_run_id: run.runId })
      .eq("id", activeLead.id);
    console.log("whatsapp.inbound: restarted workflow", { leadId: activeLead.id, runId: run.runId });
  }

  const hasActiveRun = !!(activeLead as { workflow_run_id?: string | null }).workflow_run_id;

  if (!hasActiveRun) {
    try {
      await restartWorkflow();
      return { status: 200, body: { ok: true, restarted: true } };
    } catch (err) {
      console.error("restartWorkflow failed", { leadId: lead.id, err: String(err) });
      return { status: 500, body: { error: "restart failed" } };
    }
  }

  const token = (lead as { hook_token?: string | null }).hook_token || `lead:${lead.id}:inbound`;
  try {
    await resumeHook(token, { text, timestamp: Math.floor(n.timestampMs / 1000) || Date.now() });
    return { status: 200, body: { ok: true } };
  } catch (err) {
    console.warn("resumeHook failed — restarting workflow", { leadId: lead.id, token, err: String(err) });
    try {
      await restartWorkflow();
      return { status: 200, body: { ok: true, restarted: true } };
    } catch (err2) {
      console.error("restartWorkflow failed", { leadId: lead.id, err: String(err2) });
      return { status: 500, body: { error: "resume+restart failed" } };
    }
  }
}
