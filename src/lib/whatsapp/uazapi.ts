import type { InstanceConfig, SendResult, StatusResult, WhatsappAdapter } from "./types";

/** Remove barra(s) final(is) da base URL para evitar `//path`. */
function base(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Adapter uazapi — encapsula exatamente o comportamento que o CRM já usava:
 * auth por header `token`, envio em `/send/text`, presence em `/message/presence`
 * e status em `/status`.
 */
export const uazapiAdapter: WhatsappAdapter = {
  async sendText(cfg: InstanceConfig, phone: string, text: string): Promise<SendResult> {
    let res: Response;
    try {
      res = await fetch(`${base(cfg.url)}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: cfg.token },
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

    const data = raw as { id?: string; messageid?: string };
    return { ok: true, httpStatus: res.status, messageId: data?.id ?? data?.messageid ?? null, raw };
  },

  async sendPresence(cfg: InstanceConfig, phone: string): Promise<void> {
    await fetch(`${base(cfg.url)}/message/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: cfg.token },
      body: JSON.stringify({ number: phone, presence: "composing" }),
    });
  },

  async getStatus(cfg: InstanceConfig): Promise<StatusResult> {
    try {
      const res = await fetch(`${base(cfg.url)}/status`, {
        method: "GET",
        headers: { token: cfg.token, "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        return { ok: false, status: "unknown", raw: { httpStatus: res.status } };
      }
      const j = await res.json();
      const inst = j?.status?.checked_instance ?? {};
      const serverStatus = j?.status?.server_status ?? "unknown";
      return {
        ok: true,
        status: inst.connection_status ?? serverStatus,
        name: inst.name ?? null,
        raw: j,
      };
    } catch (err) {
      return { ok: false, status: "unknown", error: String(err) };
    }
  },
};
