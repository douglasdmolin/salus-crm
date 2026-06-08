import { NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  const [appsRes, stagesRes, dailyRes, aiTodayRes] = await Promise.all([
    supabase
      .from("applications")
      .select("crm_stage, ai_paused, ai_sentiment, reply_count, created_at, do_not_contact")
      .is("deleted_at", null),
    supabase
      .from("kanban_stages")
      .select("id, label, color, owner, ai_enabled, position")
      .eq("is_active", true)
      .order("position"),
    supabase
      .from("applications")
      .select("created_at")
      .is("deleted_at", null)
      .gte("created_at", new Date(Date.now() - 14 * 86400_000).toISOString()),
    supabase
      .from("ai_events")
      .select("event_type, stage")
      .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
  ]);

  const apps = appsRes.data ?? [];
  const stages = stagesRes.data ?? [];

  // ─── Summary ───────────────────────────────────────────────
  const TERMINAL = new Set(["perdido", "descartado", "fechamento", "ganho"]);
  const active = apps.filter((a) => !TERMINAL.has(a.crm_stage));
  const created7d = apps.filter(
    (a) => new Date(a.created_at).getTime() > Date.now() - 7 * 86400_000
  );
  const replied = apps.filter((a) => (a.reply_count ?? 0) > 0);
  const positive = apps.filter((a) => a.ai_sentiment === "positive");
  const aiActive = active.filter((a) => !a.ai_paused);
  const discarded7d = apps.filter(
    (a) =>
      (a.crm_stage === "descartado" || a.crm_stage === "perdido") &&
      new Date(a.created_at).getTime() > Date.now() - 7 * 86400_000
  );

  // Response rate (replied / total who got at least one message)
  const sentMessage = apps.filter((a) => a.crm_stage !== "novo" && a.crm_stage !== "lead_qualificado");
  const responseRate = sentMessage.length > 0 ? replied.length / sentMessage.length : 0;

  // ─── Stage counts ────────────────────────────────────────────
  const countByStage: Record<string, number> = {};
  for (const a of apps) countByStage[a.crm_stage] = (countByStage[a.crm_stage] ?? 0) + 1;

  const stageData = stages.map((s) => ({
    id: s.id,
    label: s.label as string,
    color: s.color as string,
    owner: s.owner as string,
    ai_enabled: Boolean(s.ai_enabled),
    count: countByStage[s.id] ?? 0,
  }));

  // ─── Daily created (last 14 days) ───────────────────────────
  const buckets: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  for (const a of dailyRes.data ?? []) {
    const day = a.created_at.slice(0, 10);
    if (day in buckets) buckets[day]++;
  }
  const dailyCreated = Object.entries(buckets).map(([date, count]) => ({ date, count }));

  // ─── Sentiment ───────────────────────────────────────────────
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const a of apps) {
    if (a.ai_sentiment === "positive") sentiment.positive++;
    else if (a.ai_sentiment === "negative") sentiment.negative++;
    else sentiment.neutral++;
  }

  // ─── AI today ────────────────────────────────────────────────
  const aiEvents = aiTodayRes.data ?? [];
  const aiToday = {
    turns: aiEvents.filter((e) => e.event_type === "turn_start").length,
    messages: aiEvents.filter((e) => e.event_type === "message_sent").length,
    stage_changes: aiEvents.filter((e) => e.event_type === "stage_changed").length,
  };

  // ─── Funnel conversion ───────────────────────────────────────
  const totalLeads = apps.length;

  return NextResponse.json({
    summary: {
      total_active: active.length,
      total_leads: totalLeads,
      created_7d: created7d.length,
      response_rate: Math.round(responseRate * 100),
      positive_count: positive.length,
      positive_pct: active.length > 0 ? Math.round((positive.length / active.length) * 100) : 0,
      ai_active_count: aiActive.length,
      ai_active_pct: active.length > 0 ? Math.round((aiActive.length / active.length) * 100) : 0,
      discarded_7d: discarded7d.length,
    },
    stages: stageData,
    daily_created: dailyCreated,
    sentiment,
    ai_today: aiToday,
  });
}
