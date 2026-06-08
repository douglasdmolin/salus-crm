// Redaction helpers for LGPD compliance — used in all logs that go to observability

export function redactWhatsapp(w: string | null | undefined): string {
  if (!w) return "";
  // Keep first 5 and last 4: +5511****1234
  if (w.length < 10) return "****";
  return w.slice(0, 5) + "****" + w.slice(-4);
}

export function redactEmail(e: string | null | undefined): string {
  if (!e || !e.includes("@")) return "";
  const [user, domain] = e.split("@");
  return user[0] + "***@" + domain;
}

export function truncateContent(c: string | null | undefined, max = 40): string {
  if (!c) return "";
  if (c.length <= max) return c;
  return c.slice(0, max) + "...[truncated]";
}

export function redactPII<T>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;
  const masked: Record<string, unknown> = Array.isArray(obj)
    ? ([...obj] as unknown as Record<string, unknown>)
    : ({ ...(obj as object) } as Record<string, unknown>);

  for (const key of Object.keys(masked)) {
    const val = masked[key];
    if (val && typeof val === "object") {
      masked[key] = redactPII(val);
    } else if (typeof val === "string") {
      if (key === "whatsapp" || /^\+55\d{10,11}$/.test(val)) {
        masked[key] = redactWhatsapp(val);
      } else if (key === "email" || (val.includes("@") && val.length < 80)) {
        masked[key] = redactEmail(val);
      } else if (key === "content") {
        masked[key] = truncateContent(val);
      }
    }
  }
  return masked as T;
}
