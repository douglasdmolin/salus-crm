import { NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";

const ANTHROPIC = "https://api.anthropic.com";

type CostBucket = {
  starting_at: string;
  ending_at: string;
  results: Array<{ amount: string }>;
};

/**
 * Aggregates Anthropic cost_report since the configured baseline date and
 * returns spent + estimated remaining (if baseline saldo is set).
 *
 * Anthropic billing has 24-48h delay — values may lag.
 */
export async function GET() {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_ADMIN_KEY not configured" }, { status: 500 });
  }

  const supabase = createServiceClient();
  const { data: cfgRows } = await supabase
    .from("crm_config")
    .select("key, value")
    .in("key", ["anthropic_balance_baseline_usd", "anthropic_baseline_at"]);
  const cfgMap = new Map((cfgRows ?? []).map((r) => [r.key, r.value]));
  const baselineUsd = cfgMap.get("anthropic_balance_baseline_usd");
  const baselineAt = cfgMap.get("anthropic_baseline_at");

  // Anthropic cost_report only returns CLOSED day buckets — bucket for today's UTC day
  // does not exist until tomorrow. So `ending` must be at most start-of-today-UTC.
  const startOfDayUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  const baselineDate = baselineAt ? new Date(baselineAt) : new Date(Date.now() - 30 * 86400000);
  const starting = startOfDayUtc(baselineDate);
  const endingSnapped = startOfDayUtc(new Date()); // today 00:00 UTC = end of yesterday's bucket

  // If baseline was set today (or in the future), no closed buckets yet → return spent=0
  if (starting.getTime() >= endingSnapped.getTime()) {
    const baseline = baselineUsd ? Number(baselineUsd) : null;
    return NextResponse.json({
      ok: true,
      spentUsd: 0,
      baselineUsd: baseline,
      baselineAt: baselineAt ?? null,
      remainingUsd: baseline,
      windowStart: starting.toISOString(),
      windowEnd: endingSnapped.toISOString(),
      byDay: [],
      note: "Saldo carregado hoje — gasto do dia atual aparece amanhã (cost_report fecha buckets diários UTC).",
    });
  }

  const params = new URLSearchParams({
    starting_at: starting.toISOString(),
    ending_at: endingSnapped.toISOString(),
    bucket_width: "1d",
  });

  let totalCents = 0;
  const byDay: Array<{ day: string; usd: number }> = [];
  try {
    const res = await fetch(`${ANTHROPIC}/v1/organizations/cost_report?${params.toString()}`, {
      headers: { "x-api-key": adminKey, "anthropic-version": "2023-06-01" },
      cache: "no-store",
    });
    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({
        ok: false,
        error: `cost_report HTTP ${res.status}: ${txt.slice(0, 200)}`,
        debug: { starting: starting.toISOString(), ending: endingSnapped.toISOString(), baselineAt },
      }, { status: 200 });
    }
    const j = (await res.json()) as { data?: CostBucket[] };
    for (const bucket of j.data ?? []) {
      let dayCents = 0;
      for (const item of bucket.results ?? []) dayCents += Number(item.amount ?? 0);
      if (dayCents > 0) byDay.push({ day: bucket.starting_at.slice(0, 10), usd: dayCents / 100 });
      totalCents += dayCents;
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 200 });
  }

  const spentUsd = totalCents / 100;
  const baseline = baselineUsd ? Number(baselineUsd) : null;
  const remaining = baseline !== null ? baseline - spentUsd : null;

  return NextResponse.json({
    ok: true,
    spentUsd,
    baselineUsd: baseline,
    baselineAt: baselineAt ?? null,
    remainingUsd: remaining,
    windowStart: starting.toISOString(),
    windowEnd: endingSnapped.toISOString(),
    byDay: byDay.slice(-10), // últimos 10 dias com gasto
    note: "Anthropic billing tem delay de 24-48h. Valores podem estar atrasados.",
  });
}
