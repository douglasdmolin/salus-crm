"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { KanbanBoard } from "../../components/crm/KanbanBoard";
import { ChatModal } from "../../components/crm/ChatModal";
import { TweaksPanel } from "../../components/crm/TweaksPanel";
import { StatsBar } from "../../components/crm/StatsBar";
import { Dashboard } from "../../components/crm/Dashboard";
import { Icon } from "../../components/crm/Icon";
import { useTweaks } from "../../components/crm/tweaks-store";
import type { UiLead } from "../../components/crm/ui-lead";

type View = "kanban" | "dashboard";

export default function CrmPage() {
  const [selected, setSelected] = useState<UiLead | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("kanban");
  const { togglePanel, panelVisible } = useTweaks();

  return (
    <>
      {/* ── Tarja superior Salus Cyan ── */}
      <div style={{
        height: 3,
        background: "linear-gradient(90deg, #0a2342 0%, #00b4cc 50%, #1e6fa8 100%)",
        flexShrink: 0,
      }} />

      {/* ── Header Salus Navy ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          background: "#0a2342",
          flexShrink: 0,
          gap: 16,
          height: 52,
        }}
      >
        {/* ── Brand ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Image
              src="/salus-logo.png"
              alt="SALUS"
              width={88}
              height={28}
              style={{ filter: "brightness(0) invert(1)", objectFit: "contain" }}
              priority
            />
            <div style={{
              width: 1,
              height: 22,
              background: "rgba(255,255,255,0.15)",
              flexShrink: 0,
            }} />
            <div>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#00b4cc",
                lineHeight: 1,
              }}>
                CRM
              </div>
              <div style={{
                fontSize: 9.5,
                color: "rgba(255,255,255,0.4)",
                lineHeight: 1,
                marginTop: 2,
                letterSpacing: "0.02em",
              }}>
                Água que transforma.
              </div>
            </div>
          </div>

          {/* ── View toggle ── */}
          <div style={{
            display: "flex", alignItems: "center",
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8, padding: 2, gap: 2,
          }}>
            {([
              { key: "kanban",    label: "Kanban",    icon: "📋" },
              { key: "dashboard", label: "Dashboard", icon: "📊" },
            ] as { key: View; label: string; icon: string }[]).map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                style={{
                  padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5,
                  background: view === key ? "rgba(0,180,204,0.2)" : "transparent",
                  color: view === key ? "#00b4cc" : "rgba(255,255,255,0.5)",
                  transition: "all 0.15s",
                }}
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Search — only on kanban ── */}
        {view === "kanban" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, maxWidth: 380 }}>
            <div style={{
              flex: 1, position: "relative", display: "flex", alignItems: "center",
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 7, padding: "0 10px", height: 32,
            }}>
              <Icon name="search" size={13} style={{ color: "rgba(255,255,255,0.4)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar lead, nome..."
                style={{
                  flex: 1, border: "none", outline: "none",
                  background: "transparent", padding: "0 8px",
                  fontSize: 13, color: "#ffffff",
                }}
              />
              <span style={{
                fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "JetBrains Mono, monospace",
                padding: "2px 5px", background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4,
              }}>⌘K</span>
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link
            href="/crm/config"
            title="Configurações"
            style={{
              width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 7, background: "transparent", color: "rgba(255,255,255,0.55)",
              textDecoration: "none", transition: "all 0.15s",
            }}
          >
            <Icon name="settings" size={15} />
          </Link>
          {view === "kanban" && (
            <button
              onClick={togglePanel}
              title="Tweaks"
              style={{
                width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 7,
                background: panelVisible ? "rgba(0,180,204,0.2)" : "transparent",
                color: panelVisible ? "#00b4cc" : "rgba(255,255,255,0.55)",
                transition: "all 0.15s",
              }}
            >
              <Icon name="bolt" size={14} />
            </button>
          )}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11.5, color: "rgba(255,255,255,0.45)",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#16a34a", animation: "crm-pulse 2s infinite",
            }} />
            Sistema ativo
          </div>
        </div>
      </header>

      <StatsBar />

      <main style={{ overflow: "hidden", paddingTop: view === "kanban" ? 12 : 0 }}>
        {view === "kanban" ? (
          <KanbanBoard onLeadClick={setSelected} />
        ) : (
          <Dashboard />
        )}
      </main>

      {selected && view === "kanban" && (
        <ChatModal lead={selected} onClose={() => setSelected(null)} />
      )}
      {view === "kanban" && <TweaksPanel />}
    </>
  );
}
