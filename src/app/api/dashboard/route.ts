import { NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

// Ordem do funil comercial (rank). Stages fora daqui (objecao, contato_futuro,
// perdido, descartado) são tratados à parte.
const FUNNEL: Array<{ id: string; rank: number }> = [
  { id: "lead_qualificado", rank: 0 },
  { id: "lead_contatado", rank: 1 },
  { id: "respondeu", rank: 2 },
  { id: "aquecendo", rank: 3 },
  { id: "agendado", rank: 4 },
  { id: "pos_visita", rank: 5 },
  { id: "fechado", rank: 6 },
];
const RANK: Record<string, number> = Object.fromEntries(FUNNEL.map((f) => [f.id, f.rank]));
// Aliases legados → rank
Object.assign(RANK, {
  novo: 0, followup_1: 1, diagnostico: 2, contato_respondido_pela_ia: 2,
  em_contato: 3, agendamento: 4, visita_tecnica: 4, proposta_enviada: 5, fechamento: 6, ganho: 6,
});

type Json = Record<string, unknown>;
function parseNotes(raw: string | null): Json {
  if (!raw) return {};
  try { return JSON.parse(raw) as Json; } catch { return {}; }
}
function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
}

/** Query do Supabase que aceita .range() e é "awaitable" para {data, error}. */
type PageQuery = { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }> };

/** Busca todas as linhas paginando (REST limita a 1000 por request). */
async function fetchAll<T>(build: () => PageQuery): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error || !Array.isArray(data)) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export async function GET() {
  const supabase = createServiceClient();
  const since60 = new Date(Date.now() - 60 * 86400_000).toISOString();

  type App = {
    id: string; crm_stage: string; ai_paused: boolean; ai_sentiment: string | null;
    reply_count: number | null; created_at: string; replied_at: string | null;
    do_not_contact: boolean; whatsapp_instance_id: string | null;
    qualification_notes: string | null; lead_tags: Array<{ tag: string; categoria: string }> | null;
    descarte_motivo: string | null; call_scheduled_at: string | null;
  };
  type Ev = { event_type: string; stage: string | null; details: Json | null; created_at: string; lead_id: string };
  type Msg = { application_id: string | null; status: string; attempted_at: string };
  type Recv = { application_id: string | null; received_at: string };

  const [apps, stagesRes, instRes, events, sent, recv] = await Promise.all([
    fetchAll<App>(() => supabase.from("applications")
      .select("id, crm_stage, ai_paused, ai_sentiment, reply_count, created_at, replied_at, do_not_contact, whatsapp_instance_id, qualification_notes, lead_tags, descarte_motivo, call_scheduled_at")
      .is("deleted_at", null) as unknown as PageQuery),
    supabase.from("kanban_stages").select("id, label, color, position, owner, ai_enabled").eq("is_active", true).order("position"),
    supabase.from("whatsapp_instances").select("id, name, active"),
    fetchAll<Ev>(() => supabase.from("ai_events")
      .select("event_type, stage, details, created_at, lead_id").gte("created_at", since60) as unknown as PageQuery),
    fetchAll<Msg>(() => supabase.from("message_log")
      .select("application_id, status, attempted_at").gte("attempted_at", since60) as unknown as PageQuery),
    fetchAll<Recv>(() => supabase.from("messages_received")
      .select("application_id, received_at").gte("received_at", since60) as unknown as PageQuery),
  ]);

  const stages = (stagesRes.data ?? []) as Array<{ id: string; label: string; color: string; position: number; owner: string; ai_enabled: boolean }>;
  const instances = (instRes.data ?? []) as Array<{ id: string; name: string; active: boolean }>;
  const stageMeta = new Map(stages.map((s) => [s.id, s]));

  const TERMINAL = new Set(["perdido", "descartado", "fechado", "fechamento", "ganho"]);
  const PRE_CONTACT = new Set(["lead_qualificado", "novo"]);

  // ── Furthest stage reached por lead (current + histórico de stage_changed) ──
  const furthest = new Map<string, number>();
  for (const a of apps) furthest.set(a.id, RANK[a.crm_stage] ?? 0);
  const stageChanges = events.filter((e) => e.event_type === "stage_changed");
  for (const e of stageChanges) {
    const to = (e.details?.to_stage as string) || e.stage || "";
    const r = RANK[to];
    if (r === undefined) continue;
    furthest.set(e.lead_id, Math.max(furthest.get(e.lead_id) ?? 0, r));
  }

  // ── 1. FUNIL & CONVERSÃO (cumulativo: quantos ALCANÇARAM cada etapa) ──
  const reached = FUNNEL.map((f) => ({
    id: f.id,
    label: stageMeta.get(f.id)?.label ?? f.id,
    color: stageMeta.get(f.id)?.color ?? "#94a3b8",
    reached: [...furthest.values()].filter((r) => r >= f.rank).length,
  }));
  const funnel = reached.map((s, i) => ({
    ...s,
    conversion_from_prev: i === 0 || reached[i - 1].reached === 0
      ? null
      : Math.round((s.reached / reached[i - 1].reached) * 100),
  }));

  // ── Distribuição atual (snapshot) ──
  const countByStage: Record<string, number> = {};
  for (const a of apps) countByStage[a.crm_stage] = (countByStage[a.crm_stage] ?? 0) + 1;
  const stage_distribution = stages.map((s) => ({ id: s.id, label: s.label, color: s.color, owner: s.owner, ai_enabled: Boolean(s.ai_enabled), count: countByStage[s.id] ?? 0 }));

  // Leads criados por dia (14d) — para o gráfico de tendência.
  const created14: string[] = [];
  for (let i = 13; i >= 0; i--) created14.push(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10));
  const createdMap = Object.fromEntries(created14.map((d) => [d, 0]));
  for (const a of apps) { const d = a.created_at.slice(0, 10); if (d in createdMap) createdMap[d]++; }
  const daily_created = created14.map((d) => ({ date: d, count: createdMap[d] }));

  // Atividade da IA hoje.
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayEv = events.filter((e) => e.created_at.slice(0, 10) === todayStr);
  const ai_today = {
    turns: todayEv.filter((e) => e.event_type === "turn_start").length,
    messages: todayEv.filter((e) => e.event_type.startsWith("message_sent")).length,
    stage_changes: todayEv.filter((e) => e.event_type === "stage_changed").length,
  };

  // ── 2. VELOCIDADE (tempo médio em cada etapa, via stage_changed) ──
  const byLeadChanges = new Map<string, Array<{ to: string; at: string }>>();
  for (const e of stageChanges) {
    const to = (e.details?.to_stage as string) || e.stage || "";
    if (!to) continue;
    const arr = byLeadChanges.get(e.lead_id) ?? [];
    arr.push({ to, at: e.created_at });
    byLeadChanges.set(e.lead_id, arr);
  }
  const stageDur: Record<string, number[]> = {};
  for (const arr of byLeadChanges.values()) {
    arr.sort((x, y) => x.at.localeCompare(y.at));
    for (let i = 0; i < arr.length - 1; i++) {
      (stageDur[arr[i].to] ??= []).push(hoursBetween(arr[i].at, arr[i + 1].at));
    }
  }
  const timing = FUNNEL.map((f) => {
    const arr = stageDur[f.id] ?? [];
    const avg = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    return { id: f.id, label: stageMeta.get(f.id)?.label ?? f.id, avg_hours: avg === null ? null : Math.round(avg * 10) / 10, n: arr.length };
  });

  // ── 3. QUALIDADE DA IA ──
  const turnStart = events.filter((e) => e.event_type === "turn_start").length;
  const noMessage = events.filter((e) => e.event_type === "turn_no_message").length;
  const messages = events.filter((e) => e.event_type === "message_sent" || e.event_type === "message_sent_fallback_text" || e.event_type === "message_sent_fallback_retry").length;
  const blocked = events.filter((e) => e.event_type === "stage_transition_blocked").length;
  const contacted = apps.filter((a) => !PRE_CONTACT.has(a.crm_stage));
  const replied = apps.filter((a) => (a.reply_count ?? 0) > 0);
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const a of apps) {
    if (a.ai_sentiment === "positive") sentiment.positive++;
    else if (a.ai_sentiment === "negative") sentiment.negative++;
    else sentiment.neutral++;
  }
  const ai_quality = {
    turns: turnStart,
    messages,
    no_message: noMessage,
    no_message_rate: turnStart > 0 ? Math.round((noMessage / turnStart) * 100) : 0,
    escalated: apps.filter((a) => a.ai_paused && !TERMINAL.has(a.crm_stage) && a.crm_stage !== "agendado").length,
    opt_outs: apps.filter((a) => a.do_not_contact).length,
    blocked_transitions: blocked,
    response_rate: contacted.length > 0 ? Math.round((replied.length / contacted.length) * 100) : 0,
    sentiment,
  };

  // ── 4. INTELIGÊNCIA DE MERCADO ──
  const dorCount: Record<string, number> = {};
  const archCount: Record<string, { count: number; scheduled: number; closed: number }> = {};
  const regionCount: Record<string, number> = {};
  const sourceCount: Record<string, number> = {};
  const objectionCount: Record<string, number> = {};
  for (const a of apps) {
    for (const t of a.lead_tags ?? []) {
      if (t.categoria === "dor") dorCount[t.tag] = (dorCount[t.tag] ?? 0) + 1;
    }
    const meta = parseNotes(a.qualification_notes);
    const arch = (meta.arquetipo_icp as string) || "";
    if (arch) {
      const e = (archCount[arch] ??= { count: 0, scheduled: 0, closed: 0 });
      e.count++;
      const r = furthest.get(a.id) ?? 0;
      if (r >= 4) e.scheduled++;
      if (r >= 6 || a.crm_stage === "fechado") e.closed++;
    }
    const region = (meta.localizacao_fl as string) || "";
    if (region && region !== "Florida") regionCount[region] = (regionCount[region] ?? 0) + 1;
    const src = (meta.origem_principal as string) || "";
    if (src) sourceCount[src] = (sourceCount[src] ?? 0) + 1;
    if (a.crm_stage === "objecao" || a.crm_stage === "negociacao") {
      const m = a.descarte_motivo || "objeção ativa";
      objectionCount[m] = (objectionCount[m] ?? 0) + 1;
    }
  }
  const topN = (o: Record<string, number>, n = 8) =>
    Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
  const market = {
    top_dores: topN(dorCount),
    archetypes: Object.entries(archCount).sort((a, b) => b[1].count - a[1].count).slice(0, 8)
      .map(([k, v]) => ({ key: k, count: v.count, scheduled: v.scheduled, closed: v.closed })),
    regions: topN(regionCount),
    sources: topN(sourceCount),
    objections: topN(objectionCount),
  };

  // ── 5. POR NÚMERO / EQUIPE ──
  const leadInst = new Map(apps.map((a) => [a.id, a.whatsapp_instance_id]));
  const sentByInst: Record<string, { sent: number; failed: number }> = {};
  for (const m of sent) {
    const inst = (m.application_id && leadInst.get(m.application_id)) || "—";
    const e = (sentByInst[inst] ??= { sent: 0, failed: 0 });
    if (m.status === "sent") e.sent++; else e.failed++;
  }
  const by_instance = [...instances, { id: "—", name: "Sem número / global", active: true }].map((ins) => {
    const leads = apps.filter((a) => (a.whatsapp_instance_id ?? "—") === ins.id);
    const rep = leads.filter((a) => (a.reply_count ?? 0) > 0).length;
    const sch = leads.filter((a) => (furthest.get(a.id) ?? 0) >= 4).length;
    const cls = leads.filter((a) => (furthest.get(a.id) ?? 0) >= 6 || a.crm_stage === "fechado").length;
    const s = sentByInst[ins.id] ?? { sent: 0, failed: 0 };
    return {
      id: ins.id, name: ins.name, active: ins.active,
      leads: leads.length, replied: rep, scheduled: sch, closed: cls,
      response_rate: leads.length ? Math.round((rep / leads.length) * 100) : 0,
      sent: s.sent, failed: s.failed,
      deliverability: s.sent + s.failed > 0 ? Math.round((s.sent / (s.sent + s.failed)) * 100) : null,
    };
  }).filter((r) => r.leads > 0 || r.sent > 0 || r.id !== "—");

  // ── 6. OPERAÇÃO (últimos 14 dias) ──
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10));
  const dayMap = (init = 0) => Object.fromEntries(days.map((d) => [d, init]));
  const dispatched = dayMap(), repliesD = dayMap(), scheduledD = dayMap(), closedD = dayMap();
  for (const m of sent) { const d = m.attempted_at.slice(0, 10); if (m.status === "sent" && d in dispatched) dispatched[d]++; }
  for (const r of recv) { const d = r.received_at.slice(0, 10); if (d in repliesD) repliesD[d]++; }
  for (const e of events) {
    const d = e.created_at.slice(0, 10);
    if (e.event_type === "visit_scheduled" && d in scheduledD) scheduledD[d]++;
    if (e.event_type === "lead_fechado" && d in closedD) closedD[d]++;
  }
  const daily = days.map((d) => ({ date: d, dispatched: dispatched[d], replies: repliesD[d], scheduled: scheduledD[d], closed: closedD[d] }));
  const totalSent = sent.filter((m) => m.status === "sent").length;
  const totalFailed = sent.length - totalSent;
  const operation = { daily, deliverability: { sent: totalSent, failed: totalFailed, rate: sent.length ? Math.round((totalSent / sent.length) * 100) : null } };

  // ── 7. RESULTADO / RECEITA ──
  let closedValue = 0;
  let pipelineValue = 0;
  for (const a of apps) {
    const meta = parseNotes(a.qualification_notes);
    const val = Number(String(meta.valor_acordado ?? "").replace(/[^\d.]/g, "")) || 0;
    if (a.crm_stage === "fechado") closedValue += val;
    else if ((furthest.get(a.id) ?? 0) >= 4 && !TERMINAL.has(a.crm_stage)) pipelineValue += val;
  }
  const revenue = {
    scheduled: [...furthest.values()].filter((r) => r >= 4).length,
    visited: [...furthest.values()].filter((r) => r >= 5).length,
    closed: apps.filter((a) => a.crm_stage === "fechado").length,
    lost: apps.filter((a) => a.crm_stage === "perdido" || a.crm_stage === "descartado").length,
    closed_value: closedValue,
    pipeline_value: pipelineValue,
  };

  const activeLeads = apps.filter((a) => !TERMINAL.has(a.crm_stage) && a.crm_stage !== "contato_futuro");
  const aiActive = activeLeads.filter((a) => !a.ai_paused);
  const discarded7d = apps.filter((a) =>
    (a.crm_stage === "descartado" || a.crm_stage === "perdido") &&
    new Date(a.created_at).getTime() > Date.now() - 7 * 86400_000).length;

  return NextResponse.json({
    summary: {
      total_leads: apps.length,
      total_active: activeLeads.length,
      contacted: contacted.length,
      replied: replied.length,
      response_rate: ai_quality.response_rate,
      scheduled: revenue.scheduled,
      closed: revenue.closed,
      lost: revenue.lost,
      created_7d: apps.filter((a) => new Date(a.created_at).getTime() > Date.now() - 7 * 86400_000).length,
      positive_count: sentiment.positive,
      positive_pct: activeLeads.length > 0 ? Math.round((sentiment.positive / activeLeads.length) * 100) : 0,
      ai_active_count: aiActive.length,
      ai_active_pct: activeLeads.length > 0 ? Math.round((aiActive.length / activeLeads.length) * 100) : 0,
      discarded_7d: discarded7d,
    },
    funnel, stage_distribution, timing, ai_quality, market, by_instance, operation, revenue,
    daily_created, sentiment, ai_today,
    generated_at: new Date().toISOString(),
  });
}
