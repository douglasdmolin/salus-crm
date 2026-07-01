import { NextRequest, NextResponse } from "next/server";
import { parseEvolutionWebhook } from "../../../../lib/whatsapp";
import { handleInbound } from "../../../../lib/whatsapp/process-inbound";
import { getWhatsappConfig } from "../../../../lib/crm-config";
import { evolutionGetMediaBase64 } from "../../../../lib/whatsapp/evolution";
import { uploadAudio } from "../../../../lib/whatsapp/media";
import { transcribeAudio } from "../../../../lib/whatsapp/transcribe";
import type { NormalizedInbound } from "../../../../lib/whatsapp/types";

/** Remove o base64 pesado do payload cru antes de persistir em messages_received.raw_payload. */
function stripBase64(payload: unknown): unknown {
  try {
    const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    const data = clone?.data as { message?: Record<string, unknown>; base64?: unknown } | undefined;
    if (data) {
      delete data.base64;
      if (data.message) delete (data.message as Record<string, unknown>).base64;
    }
    delete (clone as Record<string, unknown>).base64;
    return clone;
  } catch {
    return payload;
  }
}

/**
 * Áudio: baixa os bytes (base64 do payload, ou fallback getBase64FromMediaMessage),
 * sobe pro Storage (para o humano ouvir) e transcreve (para a Sofia entender).
 * Preenche inbound.text (transcrição) e inbound.mediaUrl, e limpa o base64 do raw.
 */
async function processAudio(inbound: NormalizedInbound, payload: unknown): Promise<void> {
  let b64 = inbound.audioBase64;

  // Fallback: "Webhook Base64" desativado → busca a mídia sob demanda.
  if (!b64 && inbound.mediaKey && inbound.receivingInstanceId) {
    const cfg = await getWhatsappConfig(inbound.receivingInstanceId);
    if (cfg?.provider === "evolution") {
      b64 = (await evolutionGetMediaBase64(cfg, inbound.mediaKey)) ?? undefined;
    }
  }

  if (b64) {
    const bytes = Buffer.from(b64, "base64");
    const mime = inbound.mediaType ?? "audio/ogg";
    const keyBase = inbound.messageId || String(Date.now());
    const [mediaUrl, transcript] = await Promise.all([
      uploadAudio(bytes, mime, keyBase),
      transcribeAudio(bytes, mime),
    ]);
    inbound.mediaUrl = mediaUrl ?? undefined;
    inbound.text = (transcript || "").trim() || "[áudio recebido]";
  } else {
    inbound.text = "[áudio recebido — não foi possível baixar]";
  }

  // base64 é pesado e transiente — não persistir em raw_payload.
  inbound.audioBase64 = undefined;
  inbound.raw = stripBase64(payload);
}

/**
 * Evolution API v2 webhook — endpoint dedicado ao formato Evolution (`messages.upsert`).
 * Configure no painel Evolution apontando o webhook desta instância para esta URL e
 * assine o evento MESSAGES_UPSERT. Para áudio, ative também o "Webhook Base64".
 */
export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const inbound = parseEvolutionWebhook(payload);

  console.log("evolution.webhook: event received", {
    parsed: Boolean(inbound),
    fromMe: inbound?.fromMe,
    from: inbound?.fromDigits?.slice(0, 6),
    type: inbound?.messageType,
    textLen: inbound?.text.length ?? 0,
    instance: (payload as { instance?: string })?.instance,
  });

  if (!inbound) {
    return NextResponse.json({ ok: true, ignored: "no processable message" });
  }

  // Áudio: baixa + transcreve + sobe antes de processar como mensagem.
  if (inbound.messageType === "audio") {
    await processAudio(inbound, payload);
  }

  const { status, body } = await handleInbound(inbound);
  return NextResponse.json(body, { status });
}
