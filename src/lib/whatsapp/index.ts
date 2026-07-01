import type { NormalizedInbound, WhatsappAdapter, WhatsappProvider } from "./types";
import { uazapiAdapter } from "./uazapi";
import { evolutionAdapter } from "./evolution";

export * from "./types";
export { normalizePhone } from "./normalize";

/** Seleciona o adapter da plataforma. Default uazapi (compatibilidade). */
export function getAdapter(provider: WhatsappProvider | string | null | undefined): WhatsappAdapter {
  return provider === "evolution" ? evolutionAdapter : uazapiAdapter;
}

// ────────────────────────────────────────────────────────────────────────────
// Webhook parsers — cada plataforma tem um formato próprio; ambos convertem para
// NormalizedInbound, consumido pelo processador compartilhado (process-inbound.ts).
// Retornam null quando o payload não é uma mensagem processável (sem texto/remetente
// ou evento irrelevante) — a rota responde ok/ignored.
// ────────────────────────────────────────────────────────────────────────────

/** Extrai só os dígitos, removendo sufixos como "@s.whatsapp.net" / "@g.us". */
function jidDigits(raw: string): string {
  const cleaned = raw.includes("@") ? raw.split("@")[0] : raw;
  return cleaned.replace(/\D/g, "");
}

/** Parser do webhook uazapi (mesmo formato que o CRM já tratava). */
export function parseUazapiWebhook(payload: unknown): NormalizedInbound | null {
  const data = payload as {
    chat?: { name?: string };
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

  const msg = data.message;
  if (!msg) return null;

  const whatsappRaw = msg.from ?? msg.chatid ?? "";
  const text = msg.body ?? msg.text ?? "";
  if (!whatsappRaw || !text) return null;

  const isGroup = whatsappRaw.includes("@g.us") || (msg.chatid ?? "").includes("@g.us");
  const fromDigits = jidDigits(whatsappRaw);

  const receivingRaw = String(
    data.owner ?? data.session ?? data.connectedPhone ?? data.me ?? msg.to ?? msg.me ?? data.instanceId ?? data.instance ?? "",
  );
  const receivingDigits = receivingRaw.replace(/\D/g, "");
  const receivingInstanceId = receivingDigits.length >= 10 ? receivingDigits : null;

  return {
    messageId: msg.id ?? "",
    fromDigits,
    text,
    fromMe: Boolean(msg.fromMe),
    wasSentByApi: Boolean(msg.wasSentByApi),
    timestampMs: msg.timestamp ? msg.timestamp * 1000 : Date.now(),
    chatId: msg.chatid ?? whatsappRaw,
    messageType: msg.type ?? "text",
    senderName: (msg.senderName ?? msg.pushName ?? msg.notifyName ?? data.chat?.name ?? "").trim() || undefined,
    receivingInstanceId,
    isGroup,
    raw: payload,
  };
}

/**
 * Parser do webhook Evolution API v2 (evento `messages.upsert`).
 * A instância que recebeu é identificada pelo `sender` (jid do número conectado),
 * cujos dígitos batem com whatsapp_instances.id (número com DDI).
 */
export function parseEvolutionWebhook(payload: unknown): NormalizedInbound | null {
  const data = payload as {
    event?: string;
    instance?: string;
    sender?: string;
    data?: {
      key?: {
        remoteJid?: string;
        fromMe?: boolean;
        id?: string;
        // Endereçamento LID (WhatsApp/Baileys novo): remoteJid vem como id sintético
        // "...@lid" e o telefone REAL fica em remoteJidAlt. Em grupos, o par é
        // participant (lid) / participantAlt (telefone real).
        remoteJidAlt?: string;
        participant?: string;
        participantAlt?: string;
        addressingMode?: string;
      };
      pushName?: string;
      message?: { conversation?: string; extendedTextMessage?: { text?: string } };
      messageType?: string;
      messageTimestamp?: number | string;
    };
  };

  // Só mensagens de chat interessam; ignora connection.update, presence.update, etc.
  const event = (data.event ?? "").toLowerCase();
  if (event && event !== "messages.upsert") return null;

  const d = data.data;
  const key = d?.key;
  if (!d || !key) return null;

  const remoteJid = key.remoteJid ?? "";
  const text = d.message?.conversation ?? d.message?.extendedTextMessage?.text ?? "";
  if (!remoteJid || !text) return null;

  const isGroup = remoteJid.includes("@g.us");
  // Resolve o telefone real: sob LID, o número está em remoteJidAlt (ou participantAlt
  // em grupos). Fora de LID, remoteJid já é o telefone (...@s.whatsapp.net).
  const isLid = key.addressingMode === "lid" || remoteJid.includes("@lid");
  const realJid = isLid ? (key.remoteJidAlt || key.participantAlt || remoteJid) : remoteJid;
  const fromDigits = jidDigits(realJid);

  const senderDigits = (data.sender ?? "").includes("@") ? jidDigits(data.sender ?? "") : (data.sender ?? "").replace(/\D/g, "");
  const receivingInstanceId = senderDigits.length >= 10 ? senderDigits : null;

  const tsRaw = d.messageTimestamp;
  const tsMs = tsRaw ? Number(tsRaw) * 1000 : Date.now();

  return {
    messageId: key.id ?? "",
    fromDigits,
    text,
    fromMe: Boolean(key.fromMe),
    // Evolution não sinaliza envios da própria API — o dedupe é feito por messageId
    // gravado em processed_uazapi_crm_messages no momento do envio.
    wasSentByApi: false,
    timestampMs: Number.isFinite(tsMs) ? tsMs : Date.now(),
    chatId: realJid || remoteJid,
    messageType: d.messageType ?? "conversation",
    senderName: (d.pushName ?? "").trim() || undefined,
    receivingInstanceId,
    isGroup,
    raw: payload,
  };
}
