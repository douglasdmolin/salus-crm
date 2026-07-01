import { NextRequest, NextResponse } from "next/server";
import { parseEvolutionWebhook } from "../../../../lib/whatsapp";
import { handleInbound } from "../../../../lib/whatsapp/process-inbound";

/**
 * Evolution API v2 webhook — endpoint dedicado ao formato Evolution (`messages.upsert`).
 * Configure no painel Evolution apontando o webhook desta instância para esta URL e
 * assine o evento MESSAGES_UPSERT. Faz o parse para o formato normalizado e delega a
 * regra de negócio a `handleInbound` (compartilhado com o webhook uazapi).
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

  const { status, body } = await handleInbound(inbound);
  return NextResponse.json(body, { status });
}
