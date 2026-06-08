import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../../lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceClient();

  const [{ data: inn }, { data: out }] = await Promise.all([
    supabase
      .from("messages_received")
      .select("texto, received_at, message_type")
      .eq("application_id", id)
      .order("received_at", { ascending: true }),
    supabase
      .from("message_log")
      .select("texto, attempted_at, status, error_reason")
      .eq("application_id", id)
      .eq("status", "sent")
      .order("attempted_at", { ascending: true }),
  ]);

  type Entry = { direction: "in" | "out"; content: string; ts: string; author: "ai" | "human" | "lead" };
  const msgs: Entry[] = [];
  for (const m of inn ?? []) {
    if (m.texto) msgs.push({ direction: "in", content: m.texto, ts: m.received_at, author: "lead" });
  }
  for (const m of out ?? []) {
    if (!m.texto) continue;
    // Distinguish AI vs human by error_reason sentinel set at insert time
    const isHuman = m.error_reason === "human_sent_crm" || m.error_reason === "human_sent_phone";
    msgs.push({
      direction: "out",
      content: m.texto,
      ts: m.attempted_at,
      author: isHuman ? "human" : "ai",
    });
  }
  msgs.sort((a, b) => a.ts.localeCompare(b.ts));
  return NextResponse.json({ messages: msgs });
}
