"use client";

import { useEffect, useState } from "react";
import { createBrowserClient, type Application } from "../../lib/supabase";

type Stats = {
  pipeline: number;
  open: number;
  wonMonth: number;
  aiAttending: number;
};

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    let mounted = true;

    async function fetchStats() {
      const { data } = await supabase
        .from("applications")
        .select("crm_stage, enrichment_score")
        .is("deleted_at", null);
      if (!mounted) return;
      const apps = (data as Application[]) ?? [];
      const inPipeline = apps.filter((a) =>
        ["contato_respondido_pela_ia", "em_contato", "ligacao_agendada", "call_agendada", "em_negociacao"].includes(a.crm_stage)
      );
      const open = apps.filter((a) => !["ganho", "perdido", "descartado"].includes(a.crm_stage));
      const wonThisMonth = apps.filter((a) => a.crm_stage === "ganho").length;
      const aiAttending = apps.filter((a) => a.crm_stage === "contato_respondido_pela_ia" || a.crm_stage === "em_contato").length;
      setStats({
        pipeline: inPipeline.length,
        open: open.length,
        wonMonth: wonThisMonth,
        aiAttending,
      });
    }

    fetchStats();
    const channel = supabase
      .channel("stats-bar")
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, fetchStats)
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(channel); };
  }, []);

  function StatInline({ label, value, accent }: { label: string; value: string | number; accent?: "success" | "purple" }) {
    const color = accent === "success" ? "var(--crm-success)" : accent === "purple" ? "var(--crm-stage-ia)" : "var(--crm-text)";
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 11.5, color: "var(--crm-text-3)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div style={{
      padding: "8px 20px",
      display: "flex",
      alignItems: "center",
      gap: 24,
      borderBottom: "1px solid var(--crm-border)",
      borderTop: "1px solid var(--crm-border)",
      background: "var(--crm-surface)",
      flexShrink: 0,
      fontSize: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <StatInline label="Pipeline" value={stats.pipeline} />
        <StatInline label="Em aberto" value={stats.open} />
        <StatInline label="Ganho" value={stats.wonMonth} accent="success" />
        <StatInline label="IA atendendo" value={`${stats.aiAttending} leads`} accent="purple" />
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, color: "var(--crm-text-3)", fontSize: 11.5 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--crm-success)", animation: "crm-pulse 2s infinite" }} />
        WhatsApp conectado · última sync agora
      </div>
    </div>
  );
}
