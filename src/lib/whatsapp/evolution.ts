import type { InstanceConfig, SendResult, StatusResult, WhatsappAdapter } from "./types";

/**
 * Adapter Evolution API v2.
 *
 * Diferenças-chave vs uazapi:
 * - Auth por header `apikey` (não `token`).
 * - A instância é um segmento de path (`.../sendText/{instanceName}`), não vem no body.
 * - Sucesso de envio é 201 e o id da mensagem fica em `key.id`.
 * - Status via `/instance/connectionState/{instanceName}` → { instance: { state } }.
 *
 * Requer `cfg.instance` = instanceName. Sem ele, as chamadas de path ficam inválidas.
 */
/** Remove barra(s) final(is) da base URL para evitar `//path` (ex: "https://api.dza.vc/"). */
function base(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Busca o base64 de uma mídia (áudio/imagem) sob demanda — fallback para quando o
 * "Webhook Base64" não está ativo na Evolution e o payload não traz o base64 embutido.
 * Retorna null em qualquer falha (não-fatal).
 */
export async function evolutionGetMediaBase64(cfg: InstanceConfig, messageKey: Record<string, unknown>): Promise<string | null> {
  if (!cfg.instance) return null;
  try {
    const res = await fetch(`${base(cfg.url)}/chat/getBase64FromMediaMessage/${encodeURIComponent(cfg.instance)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.token },
      body: JSON.stringify({ message: { key: messageKey }, convertToMp4: false }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { base64?: string };
    return j?.base64 ?? null;
  } catch (err) {
    console.warn("evolutionGetMediaBase64 failed", String(err));
    return null;
  }
}

export const evolutionAdapter: WhatsappAdapter = {
  async sendText(cfg: InstanceConfig, phone: string, text: string): Promise<SendResult> {
    if (!cfg.instance) {
      return { ok: false, httpStatus: 0, messageId: null, raw: { error: "missing instance_name" }, errorReason: "missing_instance" };
    }

    let res: Response;
    try {
      res = await fetch(`${base(cfg.url)}/message/sendText/${encodeURIComponent(cfg.instance)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.token },
        body: JSON.stringify({ number: phone, text }),
      });
    } catch (err) {
      return { ok: false, httpStatus: 0, messageId: null, raw: { error: String(err) }, retryAfter: "15s", errorReason: "fetch_exception" };
    }

    let raw: unknown = null;
    try {
      raw = await res.json();
    } catch {
      raw = { raw: await res.text() };
    }

    if (res.status === 429) {
      return { ok: false, httpStatus: 429, messageId: null, raw, retryAfter: "30s", errorReason: "rate_limited" };
    }
    if (res.status >= 500 && res.status < 600) {
      return { ok: false, httpStatus: res.status, messageId: null, raw, retryAfter: "10s", errorReason: `http_${res.status}` };
    }
    if (!res.ok) {
      return { ok: false, httpStatus: res.status, messageId: null, raw, errorReason: `http_${res.status}` };
    }

    const data = raw as { key?: { id?: string }; id?: string };
    return { ok: true, httpStatus: res.status, messageId: data?.key?.id ?? data?.id ?? null, raw };
  },

  async sendPresence(cfg: InstanceConfig, phone: string): Promise<void> {
    if (!cfg.instance) return;
    await fetch(`${base(cfg.url)}/chat/sendPresence/${encodeURIComponent(cfg.instance)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.token },
      body: JSON.stringify({ number: phone, delay: 1200, presence: "composing" }),
    });
  },

  async getStatus(cfg: InstanceConfig): Promise<StatusResult> {
    if (!cfg.instance) {
      return { ok: false, status: "unknown", error: "missing instance_name" };
    }
    try {
      const res = await fetch(`${base(cfg.url)}/instance/connectionState/${encodeURIComponent(cfg.instance)}`, {
        method: "GET",
        headers: { apikey: cfg.token, "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        return { ok: false, status: "unknown", raw: { httpStatus: res.status } };
      }
      const j = await res.json();
      // { instance: { instanceName, state: "open" | "connecting" | "close" } }
      const state = j?.instance?.state ?? j?.state ?? "unknown";
      const status = state === "open" ? "connected" : state === "close" ? "disconnected" : String(state);
      return {
        ok: true,
        status,
        name: j?.instance?.instanceName ?? cfg.instance,
        raw: j,
      };
    } catch (err) {
      return { ok: false, status: "unknown", error: String(err) };
    }
  },
};
