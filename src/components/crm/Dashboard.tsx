"use client";

import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StageData = {
  id: string; label: string; color: string; owner: string;
  ai_enabled: boolean; count: number;
};
type DashboardData = {
  summary: {
    total_active: number; total_leads: number; created_7d: number;
    response_rate: number; positive_count: number; positive_pct: number;
    ai_active_count: number; ai_active_pct: number; discarded_7d: number;
  };
  stages: StageData[];
  daily_created: { date: string; count: number }[];
  sentiment: { positive: number; neutral: number; negative: number };
  ai_today: { turns: number; messages: number; stage_changes: number };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function KpiCard({
  label, value, sub, color, icon,
}: { label: string; value: string | number; sub?: string; color?: string; icon: string }) {
  return (
    <div style={{
      background: "var(--crm-surface)", border: "1px solid var(--crm-border)",
      borderRadius: 10, padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        {sub && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "2px 8px",
            borderRadius: 99, background: color ? `${color}18` : "var(--crm-surface-3)",
            color: color ?? "var(--crm-text-3)",
          }}>{sub}</span>
        )}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? "var(--crm-text)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--crm-text-3)", fontWeight: 500 }}>{label}</div>
    </div>
  );
}

// ─── SVG Line Chart ───────────────────────────────────────────────────────────

function LineChart({ data }: { data: { date: string; count: number }[] }) {
  const W = 500, H = 140, PX = 8, PY = 16;
  const maxVal = Math.max(...data.map((d) => d.count), 1);
  const pts = data.map((d, i) => {
    const x = PX + (i / (data.length - 1)) * (W - PX * 2);
    const y = PY + (1 - d.count / maxVal) * (H - PY * 2);
    return { x, y, ...d };
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${path} L${pts[pts.length - 1].x},${H - PY} L${pts[0].x},${H - PY} Z`;

  // Grid lines
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((r) => ({
    y: PY + r * (H - PY * 2),
    val: Math.round(maxVal * (1 - r)),
  }));

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
          <line x1={PX} y1={g.y} x2={W - PX} y2={g.y}
            stroke="var(--crm-border)" strokeWidth="1" strokeDasharray="3 3" />
          <text x={0} y={g.y + 4} fontSize="9" fill="var(--crm-text-4)"
            textAnchor="start">{g.val}</text>
        </g>
      ))}
      <path d={area} fill="url(#lineGrad)" />
      <path d={path} fill="none" stroke="#00b4cc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#00b4cc" stroke="var(--crm-surface)" strokeWidth="2" />
      ))}
      {/* X axis labels — show only first, mid and last */}
      {[0, Math.floor(pts.length / 2), pts.length - 1].map((idx) => (
        <text key={idx} x={pts[idx].x} y={H} fontSize="9" fill="var(--crm-text-3)" textAnchor="middle">
          {fmtDate(pts[idx].date)}
        </text>
      ))}
    </svg>
  );
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────

function DonutChart({ positive, neutral, negative }: { positive: number; neutral: number; negative: number }) {
  const total = positive + neutral + negative || 1;
  const R = 52, r = 34, CX = 70, CY = 70;
  const segments = [
    { value: positive, color: "#16a34a", label: "Positivo" },
    { value: neutral,  color: "#94a3b8", label: "Neutro" },
    { value: negative, color: "#dc2626", label: "Negativo" },
  ];
  let startAngle = -Math.PI / 2;
  const arcs = segments.map((seg) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1 = CX + R * Math.cos(startAngle);
    const y1 = CY + R * Math.sin(startAngle);
    const x2 = CX + R * Math.cos(endAngle);
    const y2 = CY + R * Math.sin(endAngle);
    const large = angle > Math.PI ? 1 : 0;
    const ix1 = CX + r * Math.cos(startAngle);
    const iy1 = CY + r * Math.sin(startAngle);
    const ix2 = CX + r * Math.cos(endAngle);
    const iy2 = CY + r * Math.sin(endAngle);
    const d = angle < 0.01 ? "" :
      `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${ix2.toFixed(1)},${iy2.toFixed(1)} A${r},${r} 0 ${large} 0 ${ix1.toFixed(1)},${iy1.toFixed(1)} Z`;
    startAngle = endAngle;
    return { ...seg, d };
  });

  const positivePct = Math.round((positive / total) * 100);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg viewBox="0 0 140 140" style={{ width: 130, height: 130, flexShrink: 0 }}>
        {arcs.map((a, i) => a.d && (
          <path key={i} d={a.d} fill={a.color} />
        ))}
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--crm-text)">
          {positivePct}%
        </text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize="9" fill="var(--crm-text-3)">positivo</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {arcs.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "var(--crm-text-2)" }}>{s.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--crm-text)", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
              {s.value}
            </span>
          </div>
        ))}
        <div style={{ fontSize: 10.5, color: "var(--crm-text-4)", marginTop: 2 }}>
          Total: {total} leads
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      fetch("/api/dashboard")
        .then((r) => r.json())
        .then((d) => { setData(d); setLoading(false); })
        .catch(() => setLoading(false));
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  const sectionTitle = (t: string) => (
    <div style={{
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
      color: "var(--crm-text-3)", marginBottom: 14,
    }}>{t}</div>
  );

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "var(--crm-text-3)", fontSize: 13 }}>
        Carregando dados...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--crm-danger)", fontSize: 13 }}>
        Erro ao carregar dados do dashboard.
      </div>
    );
  }

  const { summary, stages, daily_created, sentiment, ai_today } = data;

  // Active stages only (ignore terminals with 0 leads)
  const activeStages = stages.filter((s) => s.count > 0 || !["perdido", "descartado", "fechamento", "ganho"].includes(s.id));
  const maxStageCount = Math.max(...activeStages.map((s) => s.count), 1);

  return (
    <div style={{
      padding: "20px 24px 40px",
      overflowY: "auto",
      height: "calc(100vh - 120px)",
      display: "flex", flexDirection: "column", gap: 24,
    }}>

      {/* ── KPIs ── */}
      <div>
        {sectionTitle("Visão geral")}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
          <KpiCard icon="🎯" label="Leads ativos" value={summary.total_active}
            sub={`${summary.total_leads} total`} />
          <KpiCard icon="📥" label="Novos (7 dias)" value={summary.created_7d}
            color="var(--crm-accent)" sub={summary.created_7d > 0 ? "+esta semana" : "sem novos"} />
          <KpiCard icon="💬" label="Taxa de resposta" value={`${summary.response_rate}%`}
            color={summary.response_rate >= 50 ? "var(--crm-success)" : "var(--crm-warning)"}
            sub={summary.response_rate >= 50 ? "acima da meta" : "abaixo da meta"} />
          <KpiCard icon="😊" label="Sentimento positivo" value={`${summary.positive_pct}%`}
            color="var(--crm-success)" sub={`${summary.positive_count} leads`} />
          <KpiCard icon="🤖" label="IA ativa" value={`${summary.ai_active_pct}%`}
            color="var(--crm-stage-ia)" sub={`${summary.ai_active_count} leads`} />
          <KpiCard icon="🗑️" label="Perdidos (7 dias)" value={summary.discarded_7d}
            color={summary.discarded_7d > 5 ? "var(--crm-danger)" : "var(--crm-text-3)"} />
        </div>
      </div>

      {/* ── Pipeline + Trend ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Pipeline por etapa */}
        <div style={{ background: "var(--crm-surface)", border: "1px solid var(--crm-border)", borderRadius: 10, padding: 18 }}>
          {sectionTitle("Pipeline por etapa")}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeStages.map((s) => {
              const pct = Math.round((s.count / maxStageCount) * 100);
              return (
                <div key={s.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "var(--crm-text)", fontWeight: 500 }}>{s.label}</span>
                      {!s.ai_enabled && (
                        <span style={{ fontSize: 9, color: "var(--crm-text-4)", background: "var(--crm-surface-3)", padding: "1px 5px", borderRadius: 4 }}>humano</span>
                      )}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: s.count > 0 ? "var(--crm-text)" : "var(--crm-text-4)", fontVariantNumeric: "tabular-nums" }}>
                      {s.count}
                    </span>
                  </div>
                  <div style={{ height: 6, background: "var(--crm-surface-3)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${pct}%`,
                      background: s.color,
                      borderRadius: 99,
                      opacity: s.count === 0 ? 0.2 : 0.85,
                      transition: "width 0.6s ease",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tendência */}
        <div style={{ background: "var(--crm-surface)", border: "1px solid var(--crm-border)", borderRadius: 10, padding: 18 }}>
          {sectionTitle("Leads criados — últimos 14 dias")}
          <div style={{ height: 160 }}>
            <LineChart data={daily_created} />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
            <div>
              <div style={{ fontSize: 10.5, color: "var(--crm-text-3)" }}>Semana atual</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--crm-accent)" }}>
                {daily_created.slice(-7).reduce((s, d) => s + d.count, 0)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: "var(--crm-text-3)" }}>Semana anterior</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--crm-text-2)" }}>
                {daily_created.slice(-14, -7).reduce((s, d) => s + d.count, 0)}
              </div>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              {(() => {
                const curr = daily_created.slice(-7).reduce((s, d) => s + d.count, 0);
                const prev = daily_created.slice(-14, -7).reduce((s, d) => s + d.count, 0);
                const diff = curr - prev;
                const color = diff > 0 ? "var(--crm-success)" : diff < 0 ? "var(--crm-danger)" : "var(--crm-text-3)";
                return prev > 0 ? (
                  <>
                    <div style={{ fontSize: 10.5, color: "var(--crm-text-3)" }}>variação</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color }}>
                      {diff > 0 ? "+" : ""}{diff}
                    </div>
                  </>
                ) : null;
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* ── Sentiment + AI ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Sentimento */}
        <div style={{ background: "var(--crm-surface)", border: "1px solid var(--crm-border)", borderRadius: 10, padding: 18 }}>
          {sectionTitle("Distribuição de sentimento")}
          <DonutChart positive={sentiment.positive} neutral={sentiment.neutral} negative={sentiment.negative} />
        </div>

        {/* IA hoje */}
        <div style={{ background: "var(--crm-surface)", border: "1px solid var(--crm-border)", borderRadius: 10, padding: 18 }}>
          {sectionTitle("Atividade da IA — hoje")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            {[
              { icon: "🔄", label: "Turnos", value: ai_today.turns },
              { icon: "💬", label: "Mensagens", value: ai_today.messages },
              { icon: "↗️", label: "Transições", value: ai_today.stage_changes },
            ].map((m) => (
              <div key={m.label} style={{
                textAlign: "center", padding: "12px 8px",
                background: "var(--crm-surface-2)", borderRadius: 8,
                border: "1px solid var(--crm-border)",
              }}>
                <div style={{ fontSize: 20 }}>{m.icon}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--crm-text)", fontVariantNumeric: "tabular-nums", marginTop: 4 }}>
                  {m.value}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--crm-text-3)", marginTop: 2 }}>{m.label}</div>
              </div>
            ))}
          </div>
          <div style={{
            padding: 12, background: "var(--crm-accent-soft)", borderRadius: 8,
            border: "1px solid var(--crm-accent-soft-2)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--crm-accent)", marginBottom: 6 }}>
              Status da Sofia
            </div>
            <div style={{ fontSize: 12, color: "var(--crm-text-2)", lineHeight: 1.6 }}>
              <div>🤖 {summary.ai_active_count} leads com IA ativa ({summary.ai_active_pct}%)</div>
              <div>⏸️ {summary.total_active - summary.ai_active_count} leads com IA pausada</div>
              <div>📊 {summary.response_rate}% de taxa de resposta geral</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabela detalhada ── */}
      <div style={{ background: "var(--crm-surface)", border: "1px solid var(--crm-border)", borderRadius: 10, padding: 18 }}>
        {sectionTitle("Detalhamento por etapa")}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["Etapa", "Leads", "% do Total", "Owner", "IA"].map((h) => (
                  <th key={h} style={{
                    textAlign: "left", padding: "6px 12px",
                    borderBottom: "2px solid var(--crm-border)",
                    color: "var(--crm-text-3)", fontWeight: 600, fontSize: 11,
                    textTransform: "uppercase", letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stages.filter((s) => s.count > 0).map((s, i) => (
                <tr key={s.id} style={{ background: i % 2 ? "var(--crm-surface-2)" : "transparent" }}>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 500 }}>{s.label}</span>
                    </div>
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.count}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 4, background: "var(--crm-surface-3)", borderRadius: 99, maxWidth: 80 }}>
                        <div style={{
                          height: "100%", borderRadius: 99,
                          width: `${Math.round((s.count / (summary.total_leads || 1)) * 100)}%`,
                          background: s.color,
                        }} />
                      </div>
                      <span style={{ color: "var(--crm-text-2)", fontVariantNumeric: "tabular-nums" }}>
                        {Math.round((s.count / (summary.total_leads || 1)) * 100)}%
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--crm-text-2)" }}>
                    {s.owner === "ia" ? "🤖 IA" : "👤 Humano"}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{
                      fontSize: 10.5, fontWeight: 600, padding: "2px 7px",
                      borderRadius: 99,
                      background: s.ai_enabled ? "#ede9fe" : "var(--crm-surface-3)",
                      color: s.ai_enabled ? "#7c3aed" : "var(--crm-text-4)",
                    }}>
                      {s.ai_enabled ? "ativa" : "inativa"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
