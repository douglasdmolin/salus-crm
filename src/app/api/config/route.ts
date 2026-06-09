import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase";
import { ALLOWED_MODELS, getCarolConfig, getUazapiConfig, getNotificationPhone, CAROL_DEFAULT_PROMPT } from "../../../lib/crm-config";
import { getGoogleCalendarConfig } from "../../../lib/google-calendar";

export async function GET() {
  const [cfg, uazapi, notificationPhone, gcal] = await Promise.all([
    getCarolConfig(),
    getUazapiConfig(),
    getNotificationPhone(),
    getGoogleCalendarConfig(),
  ]);

  const supabase = createServiceClient();
  const { data: cpRow } = await supabase
    .from("crm_config")
    .select("value")
    .eq("key", "copy_generation_prompt")
    .maybeSingle();

  return NextResponse.json({
    ...cfg,
    defaultPrompt: CAROL_DEFAULT_PROMPT,
    allowedModels: ALLOWED_MODELS,
    uazapiUrl:      uazapi?.url      ?? process.env.UAZAPI_URL      ?? null,
    uazapiInstance: uazapi?.instance ?? process.env.UAZAPI_INSTANCE ?? null,
    uazapiTokenSet: Boolean(uazapi?.token ?? process.env.UAZAPI_TOKEN),
    notificationPhone: notificationPhone ?? "",
    copyGenerationPrompt: (cpRow?.value as string) ?? "",
    gcalCalendarId:   gcal?.calendarId   ?? "",
    gcalClientEmail:  gcal?.clientEmail  ?? "",
    gcalPrivateKeySet: Boolean(gcal?.privateKey),
  });
}

export async function PUT(req: NextRequest) {
  let body: {
    prompt?: string;
    model?: string;
    temperature?: number;
    anthropicBaselineUsd?: number;
    uazapiUrl?: string;
    uazapiToken?: string;
    uazapiInstance?: string;
    notificationPhone?: string;
    gcalCalendarId?: string;
    gcalClientEmail?: string;
    gcalPrivateKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const updates: Array<{ key: string; value: string }> = [];

  if (typeof body.prompt === "string" && body.prompt.length >= 50)
    updates.push({ key: "carol_prompt", value: body.prompt });

  if (typeof body.model === "string" && ALLOWED_MODELS.some((m) => m.id === body.model))
    updates.push({ key: "carol_model", value: body.model });

  if (typeof body.temperature === "number" && body.temperature >= 0 && body.temperature <= 1.5)
    updates.push({ key: "carol_temperature", value: String(body.temperature) });

  if (typeof body.anthropicBaselineUsd === "number" && body.anthropicBaselineUsd >= 0) {
    updates.push({ key: "anthropic_balance_baseline_usd", value: String(body.anthropicBaselineUsd) });
    updates.push({ key: "anthropic_baseline_at", value: new Date().toISOString() });
  }

  if (typeof body.uazapiUrl === "string" && body.uazapiUrl.startsWith("http"))
    updates.push({ key: "uazapi_url", value: body.uazapiUrl.trim() });

  if (typeof body.uazapiToken === "string" && body.uazapiToken.trim().length > 0)
    updates.push({ key: "uazapi_token", value: body.uazapiToken.trim() });

  if (typeof body.uazapiInstance === "string")
    updates.push({ key: "uazapi_instance", value: body.uazapiInstance.trim() });

  if (typeof body.notificationPhone === "string")
    updates.push({ key: "notification_phone", value: body.notificationPhone.trim() });

  if (typeof (body as Record<string, unknown>).copyGenerationPrompt === "string")
    updates.push({ key: "copy_generation_prompt", value: (body as Record<string, unknown>).copyGenerationPrompt as string });

  if (typeof body.gcalCalendarId === "string" && body.gcalCalendarId.trim().length > 0)
    updates.push({ key: "gcal_calendar_id", value: body.gcalCalendarId.trim() });

  if (typeof body.gcalClientEmail === "string" && body.gcalClientEmail.includes("@"))
    updates.push({ key: "gcal_client_email", value: body.gcalClientEmail.trim() });

  if (typeof body.gcalPrivateKey === "string" && body.gcalPrivateKey.trim().length > 50)
    updates.push({ key: "gcal_private_key", value: body.gcalPrivateKey.trim() });

  if (updates.length === 0) return NextResponse.json({ error: "no valid fields" }, { status: 400 });

  const supabase = createServiceClient();
  for (const u of updates) {
    const { error } = await supabase
      .from("crm_config")
      .upsert({ key: u.key, value: u.value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      console.error("config PUT failed", { key: u.key, error: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const fresh = await getCarolConfig();
  return NextResponse.json({ ok: true, ...fresh });
}
