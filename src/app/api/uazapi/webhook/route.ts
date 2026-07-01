import { NextRequest, NextResponse } from "next/server";
import { parseUazapiWebhook } from "../../../../lib/whatsapp";
import { handleInbound } from "../../../../lib/whatsapp/process-inbound";

/**
 * Uazapi webhook — receives ALL WhatsApp messages for the instance (both directions).
 *
 * Faz apenas o parse do payload uazapi para o formato normalizado e delega toda a regra
 * de negócio (idempotência, criação/atualização de lead, mirror de outbound manual,
 * resume/restart do workflow) para `handleInbound` — compartilhado com o webhook Evolution.
 *
 * Estratégia (inalterada):
 * - `fromMe: false` (lead → nós): acha/cria a application, grava messages_received e
 *   retoma o workflow para a Sofia reagir (a menos que ai_paused).
 * - `fromMe: true` (nós → lead): quando enviado direto do celular (não via API), espelha
 *   em message_log como outbound humano E pausa a Carol. Envios via nossa API já são
 *   logados pelo step sendWhatsapp e filtrados por `wasSentByApi`.
 */
export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const inbound = parseUazapiWebhook(payload);

  console.log("uazapi.webhook: event received", {
    parsed: Boolean(inbound),
    fromMe: inbound?.fromMe,
    wasSentByApi: inbound?.wasSentByApi,
    from: inbound?.fromDigits?.slice(0, 6),
    type: inbound?.messageType,
    textLen: inbound?.text.length ?? 0,
  });

  if (!inbound) {
    return NextResponse.json({ ok: true, ignored: "no processable message" });
  }

  const { status, body } = await handleInbound(inbound);
  return NextResponse.json(body, { status });
}
