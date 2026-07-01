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

  let lead = (candidates ?? []).find((a) => normalizeBrPhone(a.phone) === canonical) as
    | { id: string; crm_stage: string; workflow_run_id: string | null; hook_token: string | null; do_not_contact: boolean; phone: string; ai_paused: boolean; created_at: string }
    | undefined;

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

    // Find-or-create ATÔMICO (serializado por telefone no Postgres) — evita que uma
    // rajada de mensagens crie leads/workflows duplicados. `created` diz se ESTE webhook
    // criou o lead (e deve iniciar o workflow) ou se um webhook irmão já criou (corrida).
    const { data: rpcRows, error: rpcErr } = await supabase.rpc("create_inbound_lead", {
      p_phone: phoneE164,
      p_full_name: senderName,
      p_nome_msg: senderName.split(" ")[0],
      p_stage: "respondeu",
      p_hook_token: newToken,
      p_qual_notes: JSON.stringify({ origem_principal: "inbound_whatsapp" }),
      p_instance_id: n.receivingInstanceId,
    });
    const row = (rpcRows as Array<{ id: string; created: boolean; hook_token: string | null }> | null)?.[0];

    if (rpcErr || !row) {
      console.error("whatsapp.inbound: create_inbound_lead failed", { phone: redactWhatsapp(digits), err: rpcErr?.message });
      return { status: 500, body: { error: "create lead failed" } };
    }
    const newLeadId = row.id;

    // Sempre grava a mensagem recebida (idempotência + histórico que a Sofia lê).
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
      media_url: n.mediaUrl ?? null,
      media_type: n.mediaType ?? null,
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

    if (!row.created) {
      // Corrida: um webhook irmão já criou este lead e vai iniciar o workflow. Aqui só
      // registramos a mensagem (feito acima) e entregamos ao hook do workflow vencedor —
      // NUNCA reiniciar (evita run duplicado). O workflow lê o histórico completo e o
      // debounce coalesce a rajada em UMA resposta.
      const token = row.hook_token || newToken;
      for (let i = 0; i < 3; i++) {
        try { await resumeHook(token, { text, timestamp: Math.floor(n.timestampMs / 1000) || Date.now() }); break; }
        catch { await new Promise((r) => setTimeout(r, 700)); }
      }
      console.log("whatsapp.inbound: coalesced burst message into existing run", { newLeadId });
      return { status: 200, body: { ok: true, coalesced: true, leadId: newLeadId } };
    }

    try {
      const run = await start(leadQualificationWorkflow, [newLeadId, newToken]);
      await supabase.from("applications").update({ workflow_run_id: run.runId }).eq("id", newLeadId);
      console.log("whatsapp.inbound: created inbound lead + started workflow", { newLeadId, name: senderName, runId: run.runId });
      return { status: 200, body: { ok: true, created: true, leadId: newLeadId } };
    } catch (err) {
      console.error("whatsapp.inbound: start workflow failed for inbound lead", { newLeadId, err: String(err) });
      // Zera a sentinela 'starting' para que uma próxima mensagem possa reivindicar o início.
      await supabase.from("applications").update({ workflow_run_id: null }).eq("id", newLeadId).then(undefined, () => {});
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
      media_url: n.mediaUrl ?? null,
      media_type: n.mediaType ?? null,
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
  const STARTING = "starting";
  const payload = { text, timestamp: Math.floor(n.timestampMs / 1000) || Date.now() };

  // Inicia um novo run e grava o run_id real (chamado só após vencer o claim atômico).
  async function startAndPersist(token: string): Promise<void> {
    const run = await start(leadQualificationWorkflow, [activeLead.id, token]);
    await supabase.from("applications").update({ workflow_run_id: run.runId }).eq("id", activeLead.id);
    console.log("whatsapp.inbound: started workflow", { leadId: activeLead.id, runId: run.runId });
  }

  // Reivindica ATOMICAMENTE o direito de (re)iniciar o workflow (CAS: só muda se o run_id
  // ainda for o valor que lemos). Marca 'starting' + novo token. Retorna o token se venceu,
  // ou null se outro webhook já assumiu — evita 2 workflows para o mesmo lead.
  async function claimStart(prevRun: string | null): Promise<string | null> {
    const newToken = `lead:${activeLead.id}:inbound:${randomUUID()}`;
    let q = supabase.from("applications").update({ workflow_run_id: STARTING, hook_token: newToken });
    q = prevRun === null ? q.is("workflow_run_id", null) : q.eq("workflow_run_id", prevRun);
    const { data: claimed } = await q.eq("id", activeLead.id).select("id").maybeSingle();
    return claimed ? newToken : null;
  }

  // Entrega best-effort ao hook do workflow (com pequeno retry pra cobrir o hook subindo).
  async function tryResume(token: string): Promise<boolean> {
    for (let i = 0; i < 3; i++) {
      try { await resumeHook(token, payload); return true; }
      catch { await new Promise((r) => setTimeout(r, 600)); }
    }
    return false;
  }

  const runId = (activeLead as { workflow_run_id?: string | null }).workflow_run_id ?? null;
  const curToken = (activeLead as { hook_token?: string | null }).hook_token || `lead:${activeLead.id}:inbound`;

  // Invariante: o workflow LIMPA o run_id ao terminar (finally, via CAS por token).
  // Logo, run_id != null ⟺ há um workflow vivo (ou subindo). Nunca reiniciamos daqui —
  // isso elimina a corrida start+restart que criava 2 workflows.
  //
  // run_id != null (sentinela 'starting' OU run real) → só entrega a mensagem. Se o hook
  // ainda não está sendo consumido (workflow no sleep inicial), a entrega falha de leve e a
  // mensagem fica no histórico — o branch de abertura do workflow a lê e responde 1 vez.
  if (runId) {
    await tryResume(curToken);
    return { status: 200, body: { ok: true, coalesced: true } };
  }

  // run_id null → nenhum workflow vivo → inicia (CAS a partir de null; só um webhook vence).
  const startToken = await claimStart(null);
  if (startToken) {
    try { await startAndPersist(startToken); return { status: 200, body: { ok: true, started: true } }; }
    catch (err) {
      console.error("start failed", { leadId: activeLead.id, err: String(err) });
      await supabase.from("applications").update({ workflow_run_id: null }).eq("id", activeLead.id).eq("workflow_run_id", STARTING).then(undefined, () => {});
      return { status: 500, body: { error: "start failed" } };
    }
  }
  await tryResume(curToken); // outro venceu o claim → best-effort
  return { status: 200, body: { ok: true, coalesced: true } };
}
