"use client";

import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StageData = { id: string; label: string; color: string; owner: string; ai_enabled: boolean; count: number };
type FunnelStep = { id: string; label: string; color: string; reached: number; conversion_from_prev: number | null };
type TimingStep = { id: string; label: string; avg_hours: number | null; n: number };
type MarketItem = { key: string; count: number };
type ArchItem = { key: string; count: number; scheduled: number; closed: number };
type InstanceRow = {
  id: string; name: string; active: boolean; leads: number; replied: number;
  scheduled: number; closed: number; response_rate: number; sent: number; failed: number; deliverability: number | null;
};
type DashboardData = {
  summary: {
    total_leads: number; total_active: number; contacted: number; replied: number; response_rate: number;
    scheduled: number; closed: number; lost: number; created_7d: number;
    positive_count: number; positive_pct: number; ai_active_count: number; ai_active_pct: number; discarded_7d: number;
  };
  funnel: FunnelStep[];
  stage_distribution: StageData[];
  timing: TimingStep[];
  ai_quality: {
    turns: number; messages: number; no_message: number; no_message_rate: number;
    escalated: number; opt_outs: number; blocked_transitions: number; response_rate: number;
    sentiment: { positive: number; neutral: number; negative: number };
  };
  market: { top_dores: MarketItem[]; archetypes: ArchItem[]; regions: MarketItem[]; sources: MarketItem[]; objections: MarketItem[] };
  by_instance: InstanceRow[];
  operation: { daily: { date: string; dispatched: number; replies: number; scheduled: number; closed: number }[]; deliverability: { sent: number; failed: number; rate: number | null } };
  revenue: { scheduled: number; visited: number; closed: number; lost: number; closed_value: number; pipeline_value: number };
  daily_created: { date: string; count: number }[];
  sentiment: { positive: number; neutral: number; negative: number };
  ai_today: { turns: number; messages: number; stage_changes: number };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
function fmtUsd(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`;
}
function prettyTag(s: string) {
  return s.replace(/^dor_/, "").replace(/^icp_/, "").replace(/_/g, " ");
}

const CARD: React.CSSProperties = {
  background: "var(--crm-surface)", border: "1px solid var(--crm-border)", borderRadius: 10, padding: 18,
};

function KpiCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color?: string; icon: string }) {
  return (
    <div style={{ ...CARD, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        {sub && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: color ? `${color}18` : "var(--crm-surface-3)", color: color ?? "var(--crm-text-3)" }}>{sub}</span>
        )}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? "var(--crm-text)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--crm-text-3)", fontWeight: 500 }}>{label}</div>
    </div>
  );
}

/** Lista horizontal "rótulo + barra + contagem" (dores, regiões, origens, objeções). */
function TopList({ items, color, empty }: { items: { key: string; count: number; extra?: string }[]; color: string; empty: string }) {
  if (!items.length) return <div style={{ fontSize: 12, color: "var(--crm-text-4)", padding: "8px 0" }}>{empty}</div>;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((it) => (
        <div key={it.key}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ fontSize: 12, color: "var(--crm-text-2)", textTransform: "capitalize" }}>{prettyTag(it.key)}{it.extra && <span style={{ color: "var(--crm-text-4)", marginLeft: 6 }}>{it.extra}</span>}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--crm-text)", fontVariantNumeric: "tabular-nums" }}>{it.count}</span>
          </div>
          <div style={{ height: 5, background: "var(--crm-surface-3)", borderRadius: 99 }}>
            <div style={{ height: "100%", width: `${(it.count / max) * 100}%`, background: color, borderRadius: 99, opacity: 0.85 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LineChart({ data }: { data: { date: string; count: number }[] }) {
  const W = 500, H = 140, PX = 8, PY = 16;
  const maxVal = Math.max(...data.map((d) => d.count), 1);
  const pts = data.map((d, i) => {
    const x = PX + (i / Math.max(data.length - 1, 1)) * (W - PX * 2);
    const y = PY + (1 - d.count / maxVal) * (H - PY * 2);
    return { x, y, ...d };
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${path} L${pts[pts.length - 1].x},${H - PY} L${pts[0].x},${H - PY} Z`;
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((r) => ({ y: PY + r * (H - PY * 2), val: Math.round(maxVal * (1 - r)) }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00b4cc" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#00b4cc" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {gridY.map((g, i) => (
        <g key={i}>
          <line x1={PX} y1={g.y} x2={W - PX} y2={g.y} stroke="var(--crm-border)" strokeWidth="1" strokeDasharray="3 3" />
          <text x={0} y={g.y + 4} fontSize="9" fill="var(--crm-text-4)" textAnchor="start">{g.val}</text>
        </g>
      ))}
      <path d={area} fill="url(#lineGrad)" />
      <path d={path} fill="none" stroke="#00b4cc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (<circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#00b4cc" stroke="var(--crm-surface)" strokeWidth="2" />))}
      {[0, Math.floor(pts.length / 2), pts.length - 1].map((idx) => (
        <text key={idx} x={pts[idx].x} y={H} fontSize="9" fill="var(--crm-text-3)" textAnchor="middle">{fmtDate(pts[idx].date)}</text>
      ))}
    </svg>
  );
}

function DonutChart({ positive, neutral, negative }: { positive: number; neutral: number; negative: number }) {
  const total = positive + neutral + negative || 1;
  const R = 52, r = 34, CX = 70, CY = 70;
  const segments = [
    { value: positive, color: "#16a34a", label: "Positivo" },
    { value: neutral, color: "#94a3b8", label: "Neutro" },
    { value: negative, color: "#dc2626", label: "Negativo" },
  ];
  let startAngle = -Math.PI / 2;
  const arcs = segments.map((seg) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1 = CX + R * Math.cos(startAngle), y1 = CY + R * Math.sin(startAngle);
    const x2 = CX + R * Math.cos(endAngle), y2 = CY + R * Math.sin(endAngle);
    const large = angle > Math.PI ? 1 : 0;
    const ix1 = CX + r * Math.cos(startAngle), iy1 = CY + r * Math.sin(startAngle);
    const ix2 = CX + r * Math.cos(endAngle), iy2 = CY + r * Math.sin(endAngle);
    const d = angle < 0.01 ? "" : `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${ix2.toFixed(1)},${iy2.toFixed(1)} A${r},${r} 0 ${large} 0 ${ix1.toFixed(1)},${iy1.toFixed(1)} Z`;
    startAngle = endAngle;
    return { ...seg, d };
  });
  const positivePct = Math.round((positive / total) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg viewBox="0 0 140 140" style={{ width: 130, height: 130, flexShrink: 0 }}>
        {arcs.map((a, i) => a.d && <path key={i} d={a.d} fill={a.color} />)}
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--crm-text)">{positivePct}%</text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize="9" fill="var(--crm-text-3)">positivo</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {arcs.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "var(--crm-text-2)" }}>{s.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--crm-text)", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{s.value}</span>
          </div>
        ))}
        <div style={{ fontSize: 10.5, color: "var(--crm-text-4)", marginTop: 2 }}>Total: {total} leads</div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => fetch("/api/dashboard").then((r) => r.json()).then((d) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  const sectionTitle = (t: string, hint?: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--crm-text-3)" }}>{t}</div>
      {hint && <div style={{ fontSize: 10.5, color: "var(--crm-text-4)" }}>{hint}</div>}
    </div>
  );

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "var(--crm-text-3)", fontSize: 13 }}>Carregando dados...</div>;
  if (!data) return <div style={{ padding: 32, textAlign: "center", color: "var(--crm-danger)", fontSize: 13 }}>Erro ao carregar dados do dashboard.</div>;

  const { summary, funnel, stage_distribution, timing, ai_quality, market, by_instance, operation, revenue, daily_created } = data;
  const activeStages = stage_distribution.filter((s) => s.count > 0 || !["perdido", "descartado", "fechamento", "ganho", "contato_futuro"].includes(s.id));
  const maxStageCount = Math.max(...activeStages.map((s) => s.count), 1);
  const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };

  return (
    <div style={{ padding: "20px 24px 48px", overflowY: "auto", height: "calc(100vh - 120px)", display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── KPIs estratégicos ── */}
      <div>
        {sectionTitle("Visão geral", "últimos 60 dias")}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))", gap: 12 }}>
          <KpiCard icon="🎯" label="Leads totais" value={summary.total_leads} sub={`${summary.total_active} ativos`} />
          <KpiCard icon="💬" label="Taxa de resposta" value={`${summary.response_rate}%`}
            color={summary.response_rate >= 40 ? "var(--crm-success)" : "var(--crm-warning)"} sub={`${summary.replied}/${summary.contacted}`} />
          <KpiCard icon="📅" label="Agendamentos" value={summary.scheduled} color="var(--crm-accent)" />
          <KpiCard icon="✅" label="Fechados" value={summary.closed} color="var(--crm-success)" sub={revenue.closed_value > 0 ? fmtUsd(revenue.closed_value) : undefined} />
          <KpiCard icon="💰" label="Pipeline (em aberto)" value={fmtUsd(revenue.pipeline_value)} color="var(--crm-accent)" />
          <KpiCard icon="📥" label="Novos (7 dias)" value={summary.created_7d} color="var(--crm-accent)" />
          <KpiCard icon="🗑️" label="Perdidos" value={summary.lost} color={summary.lost > 5 ? "var(--crm-danger)" : "var(--crm-text-3)"} />
        </div>
      </div>

      {/* ── 1. Funil de conversão ── */}
      <div style={CARD}>
        {sectionTitle("Funil de conversão", "quantos leads alcançaram cada etapa e a conversão entre elas")}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {funnel.map((s) => {
            const base = funnel[0]?.reached || 1;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 130, fontSize: 12, color: "var(--crm-text-2)", display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />{s.label}
                </div>
                <div style={{ flex: 1, height: 22, background: "var(--crm-surface-3)", borderRadius: 6, overflow: "hidden", position: "relative" }}>
                  <div style={{ height: "100%", width: `${(s.reached / base) * 100}%`, background: s.color, opacity: 0.85, borderRadius: 6, minWidth: s.reached > 0 ? 2 : 0, transition: "width .6s" }} />
                  <span style={{ position: "absolute", left: 8, top: 3, fontSize: 12, fontWeight: 700, color: "var(--crm-text)" }}>{s.reached}</span>
                </div>
                <div style={{ width: 70, textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                  {s.conversion_from_prev === null ? <span style={{ color: "var(--crm-text-4)" }}>—</span>
                    : <span style={{ fontWeight: 700, color: s.conversion_from_prev >= 50 ? "var(--crm-success)" : s.conversion_from_prev >= 25 ? "var(--crm-warning)" : "var(--crm-danger)" }}>{s.conversion_from_prev}%</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Pipeline atual + Tendência ── */}
      <div style={grid2}>
        <div style={CARD}>
          {sectionTitle("Distribuição atual (onde os leads estão)")}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeStages.map((s) => {
              const pct = Math.round((s.count / maxStageCount) * 100);
              return (
                <div key={s.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "var(--crm-text)", fontWeight: 500 }}>{s.label}</span>
                      {!s.ai_enabled && <span style={{ fontSize: 9, color: "var(--crm-text-4)", background: "var(--crm-surface-3)", padding: "1px 5px", borderRadius: 4 }}>humano</span>}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: s.count > 0 ? "var(--crm-text)" : "var(--crm-text-4)", fontVariantNumeric: "tabular-nums" }}>{s.count}</span>
                  </div>
                  <div style={{ height: 6, background: "var(--crm-surface-3)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: s.color, borderRadius: 99, opacity: s.count === 0 ? 0.2 : 0.85, transition: "width .6s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={CARD}>
          {sectionTitle("Leads criados — últimos 14 dias")}
          <div style={{ height: 160 }}><LineChart data={daily_created} /></div>
        </div>
      </div>

      {/* ── 3. Qualidade da IA + Sentimento ── */}
      <div style={grid2}>
        <div style={CARD}>
          {sectionTitle("Qualidade da IA (Sofia)", "ajuste de prompts/comportamento")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { icon: "💬", label: "Taxa de resposta", value: `${ai_quality.response_rate}%`, good: ai_quality.response_rate >= 40 },
              { icon: "🔇", label: "Falhas (sem resposta)", value: `${ai_quality.no_message_rate}%`, good: ai_quality.no_message_rate <= 5 },
              { icon: "🙋", label: "Escaladas p/ humano", value: ai_quality.escalated, good: true },
              { icon: "🚫", label: "Opt-outs", value: ai_quality.opt_outs, good: ai_quality.opt_outs <= 3 },
              { icon: "↩️", label: "Retrocessos bloqueados", value: ai_quality.blocked_transitions, good: true },
              { icon: "🔄", label: "Turnos (60d)", value: ai_quality.turns, good: true },
            ].map((m) => (
              <div key={m.label} style={{ textAlign: "center", padding: "10px 6px", background: "var(--crm-surface-2)", borderRadius: 8, border: "1px solid var(--crm-border)" }}>
                <div style={{ fontSize: 17 }}>{m.icon}</div>
                <div style={{ fontSize: 19, fontWeight: 700, color: m.good ? "var(--crm-text)" : "var(--crm-warning)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{m.value}</div>
                <div style={{ fontSize: 10, color: "var(--crm-text-3)", marginTop: 2 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={CARD}>
          {sectionTitle("Sentimento dos leads")}
          <DonutChart positive={ai_quality.sentiment.positive} neutral={ai_quality.sentiment.neutral} negative={ai_quality.sentiment.negative} />
        </div>
      </div>

      {/* ── 2. Velocidade ── */}
      <div style={CARD}>
        {sectionTitle("Velocidade — tempo médio em cada etapa", "horas; identifica onde a Sofia prende o lead")}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
          {timing.map((t) => (
            <div key={t.id} style={{ padding: "10px 12px", background: "var(--crm-surface-2)", borderRadius: 8, border: "1px solid var(--crm-border)" }}>
              <div style={{ fontSize: 11, color: "var(--crm-text-3)" }}>{t.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--crm-text)", fontVariantNumeric: "tabular-nums" }}>
                {t.avg_hours === null ? "—" : t.avg_hours < 1 ? `${Math.round(t.avg_hours * 60)}min` : `${t.avg_hours}h`}
              </div>
              <div style={{ fontSize: 10, color: "var(--crm-text-4)" }}>{t.n} transiç{t.n === 1 ? "ão" : "ões"}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4. Inteligência de mercado ── */}
      <div>
        {sectionTitle("Inteligência de mercado", "base para estratégia comercial, mensagem e segmentação")}
        <div style={grid2}>
          <div style={CARD}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--crm-text-2)", marginBottom: 12 }}>🩹 Principais dores</div>
            <TopList items={market.top_dores} color="#dc2626" empty="Sem dores tagueadas ainda." />
          </div>
          <div style={CARD}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--crm-text-2)", marginBottom: 12 }}>👤 Arquétipos ICP (conversão)</div>
            <TopList items={market.archetypes.map((a) => ({ key: a.key, count: a.count, extra: `${a.scheduled} agend · ${a.closed} fech` }))} color="#7c3aed" empty="Sem arquétipos identificados ainda." />
          </div>
        </div>
        <div style={{ ...grid2, marginTop: 16, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div style={CARD}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--crm-text-2)", marginBottom: 12 }}>🛑 Objeções</div>
            <TopList items={market.objections} color="#ea580c" empty="Sem objeções registradas." />
          </div>
          <div style={CARD}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--crm-text-2)", marginBottom: 12 }}>📍 Regiões</div>
            <TopList items={market.regions} color="#0891b2" empty="Sem região identificada." />
          </div>
          <div style={CARD}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--crm-text-2)", marginBottom: 12 }}>📣 Origens</div>
            <TopList items={market.sources} color="#16a34a" empty="Sem origem registrada." />
          </div>
        </div>
      </div>

      {/* ── 5. Por número / equipe ── */}
      <div style={CARD}>
        {sectionTitle("Performance por número de WhatsApp", "saúde dos chips e desempenho por equipe")}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["Número", "Leads", "Resp.", "Taxa", "Agend.", "Fech.", "Enviadas", "Entrega"].map((h) => (
                  <th key={h} style={{ textAlign: h === "Número" ? "left" : "right", padding: "6px 12px", borderBottom: "2px solid var(--crm-border)", color: "var(--crm-text-3)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {by_instance.length === 0 && (
                <tr><td colSpan={8} style={{ padding: "12px", textAlign: "center", color: "var(--crm-text-4)" }}>Nenhum número com atividade ainda.</td></tr>
              )}
              {by_instance.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 ? "var(--crm-surface-2)" : "transparent" }}>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.active ? "var(--crm-success)" : "var(--crm-text-4)", flexShrink: 0 }} />
                      <span style={{ fontWeight: 500 }}>{r.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.leads}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.replied}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: r.response_rate >= 40 ? "var(--crm-success)" : "var(--crm-text-2)", fontVariantNumeric: "tabular-nums" }}>{r.response_rate}%</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.scheduled}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: r.closed > 0 ? "var(--crm-success)" : "var(--crm-text-3)", fontVariantNumeric: "tabular-nums" }}>{r.closed}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.sent}{r.failed > 0 && <span style={{ color: "var(--crm-danger)" }}> ({r.failed}✗)</span>}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: r.deliverability === null ? "var(--crm-text-4)" : r.deliverability >= 90 ? "var(--crm-success)" : "var(--crm-danger)", fontVariantNumeric: "tabular-nums" }}>{r.deliverability === null ? "—" : `${r.deliverability}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 6. Operação diária ── */}
      <div style={CARD}>
        {sectionTitle("Operação — últimos 14 dias", `entrega geral: ${operation.deliverability.rate === null ? "—" : operation.deliverability.rate + "%"} (${operation.deliverability.sent} enviadas / ${operation.deliverability.failed} falhas)`)}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["Dia", "Disparos", "Respostas", "Agendamentos", "Fechamentos"].map((h) => (
                  <th key={h} style={{ textAlign: h === "Dia" ? "left" : "right", padding: "5px 12px", borderBottom: "2px solid var(--crm-border)", color: "var(--crm-text-3)", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {operation.daily.slice().reverse().map((d, i) => (
                <tr key={d.date} style={{ background: i % 2 ? "var(--crm-surface-2)" : "transparent" }}>
                  <td style={{ padding: "6px 12px" }}>{fmtDate(d.date)}</td>
                  <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.dispatched || "—"}</td>
                  <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: d.replies > 0 ? "var(--crm-accent)" : "var(--crm-text-4)" }}>{d.replies || "—"}</td>
                  <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.scheduled || "—"}</td>
                  <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: d.closed > 0 ? "var(--crm-success)" : "var(--crm-text-4)" }}>{d.closed || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
