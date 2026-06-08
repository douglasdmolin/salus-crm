"use client";

import { useEffect, useState, type DragEvent as ReactDragEvent } from "react";
import { createBrowserClient, type Application, type KanbanStage } from "../../lib/supabase";
import { STAGES_SKELETON, type Stage } from "./stages";
import { LeadCard } from "./LeadCard";
import { applicationToUiLead, type UiLead, type MessageIndex } from "./ui-lead";
import { useTweaks } from "./tweaks-store";
import { DispatchModal } from "./DispatchModal";

function useStages(): { stages: Stage[]; loading: boolean } {
  const [stages, setStages] = useState<Stage[]>(STAGES_SKELETON);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stages")
      .then((r) => r.json())
      .then((data: KanbanStage[]) => {
        const active = data.filter((s) => s.is_active).map((s) => ({
          id: s.id, label: s.label, short: s.short,
          color: s.color, description: s.description,
          owner: s.owner, position: s.position, is_active: s.is_active,
        }));
        if (active.length > 0) setStages(active);
      })
      .catch(() => {/* mantém fallback */})
      .finally(() => setLoading(false));
  }, []);

  return { stages, loading };
}

function Column({
  stage,
  leads,
  onCardClick,
  onDragStart,
  onDragEnd,
  draggingId,
  onDragOver,
  onDrop,
  dragOverStage,
  onDispatchClick,
}: {
  stage: Stage;
  leads: UiLead[];
  onCardClick: (lead: UiLead) => void;
  onDragStart: (e: ReactDragEvent<HTMLDivElement>, lead: UiLead) => void;
  onDragEnd: () => void;
  draggingId: string | null;
  onDragOver: (stageId: string | null) => void;
  onDrop: (stageId: string) => void;
  dragOverStage: string | null;
  onDispatchClick?: () => void;
}) {
  const isActive = dragOverStage === stage.id;
  const { density } = useTweaks();

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(stage.id); }}
      onDragLeave={() => onDragOver(null)}
      onDrop={(e) => { e.preventDefault(); onDrop(stage.id); }}
      style={{
        width: density === "compact" ? 260 : 288,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: isActive ? "var(--crm-accent-soft)" : "transparent",
        borderRadius: "var(--crm-radius)",
        border: isActive ? "1px dashed var(--crm-accent)" : "1px dashed transparent",
        transition: "all 0.15s",
        height: "100%",
      }}
    >
      <div style={{
        padding: "10px 12px 8px 12px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: stage.color,
            boxShadow: `0 0 0 3px ${stage.color}33`,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 12.5, fontWeight: 600, color: "var(--crm-text)",
            letterSpacing: "-0.005em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{stage.label}</span>
          <span style={{
            fontSize: 11, color: "var(--crm-text-3)", fontWeight: 500,
            background: "var(--crm-surface-3)",
            padding: "1px 7px", borderRadius: 10,
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}>{leads.length}</span>
        </div>
        {onDispatchClick && leads.length > 0 && (
          <button
            type="button"
            onClick={onDispatchClick}
            title="Disparar lote para WhatsApp"
            style={{
              fontSize: 11, fontWeight: 600, color: "white",
              background: "var(--crm-accent)", border: "none",
              padding: "4px 10px", borderRadius: 6, cursor: "pointer",
              flexShrink: 0,
              display: "inline-flex", alignItems: "center", gap: 4,
            }}
          >
            ⚡ Disparar
          </button>
        )}
      </div>

      <div style={{
        flex: 1,
        padding: "0 10px 12px 10px",
        display: "flex", flexDirection: "column", gap: 8,
        overflowY: "auto", overflowX: "hidden",
      }}>
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onClick={onCardClick}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            isDragging={draggingId === lead.id}
          />
        ))}
        {leads.length === 0 && (
          <div style={{
            padding: "24px 12px", textAlign: "center",
            fontSize: 12, color: "var(--crm-text-4)",
            border: "1px dashed var(--crm-border)",
            borderRadius: 8, margin: 2,
          }}>
            Sem leads
          </div>
        )}
      </div>
    </div>
  );
}

export function KanbanBoard({ onLeadClick }: { onLeadClick?: (lead: UiLead) => void }) {
  const { stages } = useStages();
  const [apps, setApps] = useState<Application[] | null>(null);
  const [msgIdx, setMsgIdx] = useState<MessageIndex>({});
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const supabase = createBrowserClient();
    let mounted = true;

    async function fetchAll() {
      const { data, error: err } = await supabase
        .from("applications")
        .select("*")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (!mounted) return;
      if (err) {
        setError(err.message);
        setApps([]);
        return;
      }
      const appsData = (data as Application[]) ?? [];
      setApps(appsData);

      const ids = appsData.map((a) => a.id);
      if (ids.length === 0) return;

      const [{ data: recv }, { data: sent }] = await Promise.all([
        supabase
          .from("messages_received")
          .select("application_id, texto, received_at")
          .in("application_id", ids)
          .order("received_at", { ascending: false }),
        supabase
          .from("message_log")
          .select("application_id, texto, attempted_at")
          .in("application_id", ids)
          .eq("status", "sent")
          .order("attempted_at", { ascending: false }),
      ]);

      const idx: MessageIndex = {};
      for (const m of recv ?? []) {
        if (!m.application_id || !m.texto) continue;
        const existing = idx[m.application_id];
        if (!existing || m.received_at > existing.ts) {
          idx[m.application_id] = { texto: m.texto, direction: "in", ts: m.received_at };
        }
      }
      for (const m of sent ?? []) {
        if (!m.application_id || !m.texto) continue;
        const existing = idx[m.application_id];
        if (!existing || m.attempted_at > existing.ts) {
          idx[m.application_id] = { texto: m.texto, direction: "out", ts: m.attempted_at };
        }
      }
      if (mounted) setMsgIdx(idx);
    }

    fetchAll();

    const channel = supabase
      .channel("applications-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, () => {
        if (mounted) fetchAll();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_log" }, () => {
        if (mounted) fetchAll();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages_received" }, () => {
        if (mounted) fetchAll();
      })
      .subscribe();

    const poll = setInterval(() => { if (mounted) fetchAll(); }, 30_000);

    return () => {
      mounted = false;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [refreshTick]);

  const leads: UiLead[] = (apps ?? []).map((a) => applicationToUiLead(a, msgIdx));

  const handleDragStart = (e: ReactDragEvent<HTMLDivElement>, lead: UiLead) => {
    setDraggingId(lead.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverStage(null);
  };

  const handleDrop = async (stageId: string) => {
    const leadId = draggingId;
    setDraggingId(null);
    setDragOverStage(null);
    if (!leadId) return;
    setApps((prev) => prev?.map((a) => (a.id === leadId ? { ...a, crm_stage: stageId } : a)) ?? prev);
    const res = await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crm_stage: stageId }),
    });
    if (!res.ok) {
      console.error("Failed to persist stage change:", await res.text());
      const supabase = createBrowserClient();
      const { data } = await supabase.from("applications").select("*").eq("id", leadId).single();
      if (data) {
        setApps((prev) => prev?.map((a) => (a.id === leadId ? (data as Application) : a)) ?? prev);
      }
    }
  };

  if (apps === null) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
          {stages.map((s) => (
            <div
              key={s.id}
              style={{
                minWidth: 280, height: 400,
                animation: "crm-shimmer 1.5s infinite",
                backgroundImage: "linear-gradient(90deg, var(--crm-surface-2) 0%, var(--crm-surface-3) 50%, var(--crm-surface-2) 100%)",
                backgroundSize: "200% 100%",
                borderRadius: "var(--crm-radius)",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: 16, margin: 20,
        background: "var(--crm-danger-soft)",
        border: "1px solid var(--crm-danger)",
        borderRadius: "var(--crm-radius)",
        color: "var(--crm-danger)",
      }}>
        Erro ao carregar leads: {error}
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", gap: 10,
      padding: "0 20px 20px 20px",
      height: "calc(100vh - 120px)",
      overflowX: "auto", overflowY: "hidden",
    }}>
      {stages.map((stage) => (
        <Column
          key={stage.id}
          stage={stage}
          leads={leads.filter((l) => l.stage === stage.id)}
          onCardClick={(lead) => onLeadClick?.(lead)}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          draggingId={draggingId}
          onDragOver={setDragOverStage}
          onDrop={handleDrop}
          dragOverStage={dragOverStage}
          onDispatchClick={
            ["lead_qualificado", "lead_contatado", "novo"].includes(stage.id)
              ? () => setDispatchOpen(true)
              : undefined
          }
        />
      ))}
      <DispatchModal
        open={dispatchOpen}
        eligibleCount={leads.filter((l) =>
          ["lead_qualificado", "lead_contatado", "novo"].includes(l.stage)
        ).length}
        onClose={() => setDispatchOpen(false)}
        onDispatched={() => setRefreshTick((t) => t + 1)}
      />
    </div>
  );
}
