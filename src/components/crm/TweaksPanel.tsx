"use client";

import { useState } from "react";
import { Icon } from "./Icon";
import { useTweaks } from "./tweaks-store";
import { DebugGlossaryModal } from "./DebugGlossaryModal";

export function TweaksPanel() {
  const {
    density,
    showSentiment,
    showNextAction,
    showPreview,
    showAssignee,
    debugSources,
    panelVisible,
    setTweak,
    applyPreset,
    togglePanel,
  } = useTweaks();
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  if (!panelVisible) return null;

  return (
    <div style={{
      position: "fixed",
      top: 72,
      right: 16,
      width: 280,
      background: "var(--crm-surface)",
      border: "1px solid var(--crm-border)",
      borderRadius: "var(--crm-radius-lg)",
      boxShadow: "var(--crm-shadow-lg)",
      padding: 16,
      zIndex: 90,
      animation: "crm-slideUp 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="bolt" size={13} /> Tweaks
        </div>
        <button onClick={togglePanel} aria-label="Fechar" style={{ color: "var(--crm-text-3)" }}>
          <Icon name="close" size={14} />
        </button>
      </div>

      {/* Presets */}
      <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Preset</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => applyPreset("rich")}
          style={{
            flex: 1,
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            background: density === "rich" ? "var(--crm-accent)" : "var(--crm-surface-2)",
            color: density === "rich" ? "#fff" : "var(--crm-text-2)",
            border: "1px solid var(--crm-border)",
          }}
        >Rica</button>
        <button
          onClick={() => applyPreset("clean")}
          style={{
            flex: 1,
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            background: density === "compact" ? "var(--crm-accent)" : "var(--crm-surface-2)",
            color: density === "compact" ? "#fff" : "var(--crm-text-2)",
            border: "1px solid var(--crm-border)",
          }}
        >Clean</button>
      </div>

      {/* Density */}
      <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Densidade</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["compact", "medium", "rich"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setTweak("density", d)}
            style={{
              flex: 1,
              padding: "5px 8px",
              fontSize: 11,
              borderRadius: 5,
              background: density === d ? "var(--crm-accent-soft)" : "var(--crm-surface-2)",
              color: density === d ? "var(--crm-accent)" : "var(--crm-text-2)",
              border: "1px solid " + (density === d ? "var(--crm-accent)" : "var(--crm-border)"),
              fontWeight: 500,
              textTransform: "capitalize",
            }}
          >{d === "compact" ? "Compacta" : d === "medium" ? "Média" : "Rica"}</button>
        ))}
      </div>

      {/* Toggles */}
      <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Cards mostram</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { key: "showSentiment" as const, label: "Sentimento", value: showSentiment },
          { key: "showNextAction" as const, label: "Próxima ação", value: showNextAction },
          { key: "showPreview" as const, label: "Preview WhatsApp", value: showPreview },
          { key: "showAssignee" as const, label: "Responsável", value: showAssignee },
        ].map((t) => (
          <label key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={t.value}
              onChange={(e) => setTweak(t.key, e.target.checked)}
              style={{ accentColor: "var(--crm-accent)" }}
            />
            <span>{t.label}</span>
          </label>
        ))}
      </div>

      <div style={{ height: 1, background: "var(--crm-border)", margin: "16px 0" }} />

      {/* Debug */}
      <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Debug</div>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={debugSources}
          onChange={(e) => setTweak("debugSources", e.target.checked)}
          style={{ accentColor: "var(--crm-warning)", marginTop: 2 }}
        />
        <div>
          <div style={{ fontWeight: 500 }}>Mostrar fontes dos dados</div>
          <div style={{ fontSize: 10.5, color: "var(--crm-text-3)", marginTop: 2 }}>
            Troca valores por tabela.coluna. Útil pra mapear mockados vs reais.
          </div>
        </div>
      </label>

      <button
        onClick={() => setGlossaryOpen(true)}
        style={{
          marginTop: 10,
          width: "100%",
          padding: "8px 12px",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          background: "var(--crm-accent-soft)",
          color: "var(--crm-accent)",
          border: "1px solid var(--crm-accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          cursor: "pointer",
        }}
        title="Explicação completa em português pra leigo — o que cada dado significa e de onde vem"
      >
        <Icon name="sparkle" size={12} />
        Abrir dicionário completo
      </button>

      {glossaryOpen && <DebugGlossaryModal onClose={() => setGlossaryOpen(false)} />}
    </div>
  );
}
