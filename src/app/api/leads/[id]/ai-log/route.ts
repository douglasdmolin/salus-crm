import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("ai_events")
    .select("id, created_at, event_type, stage, details")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ events: (data ?? []).reverse() });
}
