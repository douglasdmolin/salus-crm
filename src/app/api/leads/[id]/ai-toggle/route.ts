import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase";

/**
 * Toggle Carol (AI) on/off for a specific lead.
 * POST { paused: true }  → pause
 * POST { paused: false } → resume
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  let body: { paused?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const paused = Boolean(body.paused);
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("applications")
    .update({
      ai_paused: paused,
      ai_paused_at: paused ? new Date().toISOString() : null,
    })
    .eq("id", leadId)
    .select("id, ai_paused, ai_paused_at")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "lead not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ai_paused: data.ai_paused, ai_paused_at: data.ai_paused_at });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("applications")
    .select("ai_paused, ai_paused_at")
    .eq("id", leadId)
    .maybeSingle();
  return NextResponse.json({ ai_paused: data?.ai_paused ?? false, ai_paused_at: data?.ai_paused_at ?? null });
}
