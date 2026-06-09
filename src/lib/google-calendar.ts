import { createSign } from "crypto";
import { createServiceClient } from "./supabase";

export type GoogleCalendarConfig = {
  calendarId: string;
  clientEmail: string;
  privateKey: string;
};

export async function getGoogleCalendarConfig(): Promise<GoogleCalendarConfig | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("crm_config")
    .select("key, value")
    .in("key", ["gcal_calendar_id", "gcal_client_email", "gcal_private_key"]);

  const map = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));
  const calendarId  = map.get("gcal_calendar_id")  || "";
  const clientEmail = map.get("gcal_client_email")  || "";
  const privateKey  = map.get("gcal_private_key")   || "";

  if (!calendarId || !clientEmail || !privateKey) return null;
  return { calendarId, clientEmail, privateKey };
}

function b64url(str: string): string {
  return Buffer.from(str).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss:   clientEmail,
    scope: "https://www.googleapis.com/auth/calendar",
    aud:   "https://oauth2.googleapis.com/token",
    exp:   now + 3600,
    iat:   now,
  }));

  const unsigned = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  // Google stores private keys with literal \n — normalize to real newlines
  const sig = sign.sign(privateKey.replace(/\\n/g, "\n"), "base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth2:jwt-bearer",
      assertion:  `${unsigned}.${sig}`,
    }),
  });

  const d = await res.json() as { access_token?: string; error?: string };
  if (!d.access_token) throw new Error(`Google auth failed: ${d.error ?? JSON.stringify(d)}`);
  return d.access_token;
}

/**
 * Returns true if the calendar slot is free, false if busy.
 * startIso / endIso must be valid ISO 8601 strings.
 */
export async function isSlotAvailable(
  cfg: GoogleCalendarConfig,
  startIso: string,
  endIso: string,
): Promise<boolean> {
  const token = await getAccessToken(cfg.clientEmail, cfg.privateKey);
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ timeMin: startIso, timeMax: endIso, items: [{ id: cfg.calendarId }] }),
  });
  const d = await res.json() as { calendars?: Record<string, { busy?: unknown[] }> };
  return (d.calendars?.[cfg.calendarId]?.busy ?? []).length === 0;
}

export type CalendarEvent = {
  summary: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso: string;
};

/**
 * Creates a Google Calendar event. Returns the event HTML link.
 */
export async function createCalendarEvent(
  cfg: GoogleCalendarConfig,
  event: CalendarEvent,
): Promise<string> {
  const token = await getAccessToken(cfg.clientEmail, cfg.privateKey);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        summary:     event.summary,
        description: event.description,
        location:    event.location,
        start: { dateTime: event.startIso, timeZone: "America/New_York" },
        end:   { dateTime: event.endIso,   timeZone: "America/New_York" },
      }),
    },
  );
  const d = await res.json() as { htmlLink?: string; error?: unknown };
  if (!d.htmlLink) throw new Error(`Google Calendar event creation failed: ${JSON.stringify(d.error)}`);
  return d.htmlLink;
}
