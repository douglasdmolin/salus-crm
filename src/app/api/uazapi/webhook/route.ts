import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { resumeHook, start } from "workflow/api";
import { leadQualificationWorkflow } from "../../../../workflows/lead-qualification";
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
    chat?: { name?: string };
    // Número/instância que RECEBEU a mensagem (multi-número). No uazapi, o campo
    // principal é "owner" (seu número conectado) ou "session".
    owner?: string;
    session?: string;
    connectedPhone?: string;
    me?: string;
    instance?: string;
    instanceId?: string;
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
      senderName?: string;
      pushName?: string;
      notifyName?: string;
      to?: string;
      me?: string;
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

  // Ignora mensagens de grupo — nunca criar/responder lead a partir de um grupo.
  if (whatsappRaw.includes("@g.us") || (msg.chatid ?? "").includes("@g.us")) {
    return NextResponse.json({ ok: true, ignored: "group message" });
  }

  const cleaned = whatsappRaw.includes("@") ? whatsappRaw.split("@")[0] : whatsappRaw;
  const digits = cleaned.replace(/\D/g, "");

  // Número que RECEBEU a mensagem = identificador da instância (multi-número).
  // No uazapi vem em "owner" (número conectado) ou "session". Mapeado para
  // whatsapp_instances.id (guardado como os dígitos do número).
  // Sem número identificável → null (cai no token global, modo 1-número).
  const receivingRaw = String(
    data.owner ?? data.session ?? data.connectedPhone ?? data.me ?? msg.to ?? msg.me ?? data.instanceId ?? data.instance ?? "",
  );
  const receivingDigits = receivingRaw.replace(/\D/g, "");
  const receivingInstanceId = receivingDigits.length >= 10 ? receivingDigits : null;

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
    // Número desconhecido. Se for mensagem de ENTRADA (lead → nós), cria o lead e
    // deixa a Sofia responder automaticamente — sem precisar de disparo. Responder
    // a quem te chamou está dentro da janela de 24h do WhatsApp (não conta como
    // "iniciar nova conversa", então funciona mesmo sob reachout timelock).
    // fromMe=true sem lead = saída manual pra fora do CRM → ignora.
    if (msg.fromMe) {
      console.log("uazapi.webhook: no active lead (fromMe outbound) — ignoring", { phone: redactWhatsapp(digits) });
      return NextResponse.json({ ok: true, ignored: "no active lead (fromMe)" });
    }

    const phoneE164 = `+${digits}`;
    const senderName =
      (msg.senderName ?? msg.pushName ?? msg.notifyName ?? data.chat?.name ?? "").trim() ||
      `Contato WhatsApp ${digits.slice(-4)}`;
    const newToken = `lead:inbound:${randomUUID()}`;

    // Cria já em "respondeu": o lead iniciou a conversa, então vai direto para a
    // qualificação (Sonnet), sem mensagem de abertura.
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
        // Número (instância) que recebeu a mensagem — as respostas saem por este mesmo.
        whatsapp_instance_id: receivingInstanceId,
      })
      .select("id")
      .single();

    if (createErr || !created) {
      console.error("uazapi.webhook: failed to create inbound lead", { phone: redactWhatsapp(digits), err: createErr?.message });
      return NextResponse.json({ error: "create lead failed" }, { status: 500 });
    }
    const newLeadId = created.id as string;

    // Idempotência + grava a mensagem recebida (entra no histórico que a Sofia lê)
    if (uazapiId) {
      await supabase.from("processed_uazapi_crm_messages")
        .insert({ uazapi_id: uazapiId, application_id: newLeadId })
        .then(undefined, () => {});
    }
    await supabase.from("messages_received").insert({
      application_id: newLeadId,
      uazapi_message_id: uazapiId || `manual-${Date.now()}`,
      chatid: msg.chatid ?? whatsappRaw,
      numero: digits,
      texto: text,
      message_type: msg.type ?? "text",
      received_at: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
      raw_payload: data as Record<string, unknown>,
    }).then(undefined, (err) => console.warn("messages_received insert failed (new inbound lead)", String(err)));

    await supabase.rpc("increment_reply_count", { app_id: newLeadId }).then(
      undefined,
      async () => {
        await supabase.from("applications")
          .update({ replied_at: new Date().toISOString(), last_reply_text: text })
          .eq("id", newLeadId);
      },
    );

    // Inicia o workflow — o branch de retomada responde à mensagem pendente (sem abertura).
    try {
      const run = await start(leadQualificationWorkflow, [newLeadId, newToken]);
      await supabase.from("applications").update({ workflow_run_id: run.runId }).eq("id", newLeadId);
      console.log("uazapi.webhook: created inbound lead + started workflow", { newLeadId, name: senderName, runId: run.runId });
      return NextResponse.json({ ok: true, created: true, leadId: newLeadId });
    } catch (err) {
      console.error("uazapi.webhook: start workflow failed for inbound lead", { newLeadId, err: String(err) });
      return NextResponse.json({ error: "start workflow failed" }, { status: 500 });
    }
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

  // Reinicia um workflow morto para retomar a conversa. O workflow reiniciado
  // pula a abertura (lead não está em stage inicial) e responde a mensagem pendente,
  // que já foi gravada em messages_received acima — por isso não precisamos
  // reentregá-la via hook (evita race entre start e createHook).
  const activeLead = lead; // narrowed non-undefined pelo guard acima; preserva o tipo na closure
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
    console.log("uazapi.webhook: restarted workflow", { leadId: activeLead.id, runId: run.runId });
  }

  const hasActiveRun = !!(activeLead as { workflow_run_id?: string | null }).workflow_run_id;

  // Sem run ativo → o workflow terminou (MAX_TURNS, crash ou nunca iniciado).
  // Reinicia direto em vez de tentar resumeHook num hook inexistente.
  if (!hasActiveRun) {
    try {
      await restartWorkflow();
      return NextResponse.json({ ok: true, restarted: true });
    } catch (err) {
      console.error("restartWorkflow failed", { leadId: lead.id, err: String(err) });
      return NextResponse.json({ error: "restart failed" }, { status: 500 });
    }
  }

  // Resume workflow — usa hook_token único por run (evita rotear para workflow zumbi)
  const token = (lead as { hook_token?: string | null }).hook_token || `lead:${lead.id}:inbound`;
  try {
    await resumeHook(token, {
      text,
      timestamp: msg.timestamp ?? Date.now(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Hook não existe mais (workflow_run_id obsoleto) → reinicia o workflow.
    console.warn("resumeHook failed — restarting workflow", { leadId: lead.id, token, err: String(err) });
    try {
      await restartWorkflow();
      return NextResponse.json({ ok: true, restarted: true });
    } catch (err2) {
      console.error("restartWorkflow failed", { leadId: lead.id, err: String(err2) });
      return NextResponse.json({ error: "resume+restart failed" }, { status: 500 });
    }
  }
}
