import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase";
import { getDispatchConfig, type DispatchMode } from "../../../lib/phone-whitelist";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await getDispatchConfig();
  return NextResponse.json(cfg);
}

export async function PUT(req: NextRequest) {
  let body: { enabled?: boolean; mode?: DispatchMode; whitelistPhones?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const updates: Array<{ key: string; value: string }> = [];
  if (typeof body.enabled === "boolean") {
    updates.push({ key: "dispatch_enabled", value: body.enabled ? "true" : "false" });
  }
  if (body.mode === "all" || body.mode === "whitelist") {
    updates.push({ key: "dispatch_mode", value: body.mode });
  }
  if (Array.isArray(body.whitelistPhones)) {
    const cleaned = body.whitelistPhones
      .map((p) => String(p ?? "").replace(/[^\d+]/g, ""))
      .filter(Boolean)
      .join(",");
    updates.push({ key: "dispatch_whitelist_phones", value: cleaned });
  }
  if (updates.length === 0) return NextResponse.json({ error: "no valid fields" }, { status: 400 });

  const supabase = createServiceClient();
  for (const u of updates) {
    const { error } = await supabase
      .from("crm_config")
      .upsert({ key: u.key, value: u.value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const fresh = await getDispatchConfig();
  return NextResponse.json({ ok: true, ...fresh });
}
