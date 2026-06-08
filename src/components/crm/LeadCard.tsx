"use client";
import type { DragEvent as ReactDragEvent } from "react";
import { Icon, WhatsappIcon } from "./Icon";
import { TEAM_BY_ID, type UiLead } from "./ui-lead";
import { useTweaks } from "./tweaks-store";
import { DEBUG_SOURCES } from "./debug-sources";

function Avatar({ memberId, size = 20 }: { memberId: string; size?: number }) {
  const m = TEAM_BY_ID[memberId];
  return (
    <div
      title={m?.name}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: m?.color || "#94a3b8",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        flexShrink: 0,
        boxShadow: "0 0 0 2px var(--crm-surface)",
      }}
    >
      {m?.initials || "?"}
    </div>
  );
}

function Tag({ children, color = "neutral", size = "sm" }: {
  children: React.ReactNode;
  color?: "neutral" | "blue" | "green" | "red" | "orange" | "purple";
  size?: "sm" | "xs";
}) {
  const colors = {
    neutral: { bg: "var(--crm-surface-3)", fg: "var(--crm-text-2)" },
    blue: { bg: "var(--crm-accent-soft)", fg: "var(--crm-accent)" },
    green: { bg: "var(--crm-success-soft)", fg: "var(--crm-success)" },
    red: { bg: "var(--crm-danger-soft)", fg: "var(--crm-danger)" },
    orange: { bg: "var(--crm-warning-soft)", fg: "var(--crm-warning)" },
    purple: { bg: "#f3e8ff", fg: "#7c3aed" },
  }[color];
  return (
    <span style={{
      background: colors.bg,
      color: colors.fg,
      padding: size === "xs" ? "2px 6px" : "3px 8px",
      borderRadius: 5,
      fontSize: size === "xs" ? 10.5 : 11,
      fontWeight: 500,
      whiteSpace: "nowrap",
      letterSpacing: "0.005em",
    }}>{children}</span>
  );
}

function AiScoreBar({ score, compact = false }: { score: number; compact?: boolean }) {
  const color = score >= 75 ? "var(--crm-success)" : score >= 50 ? "var(--crm-warning)" : "var(--crm-text-3)";
  const label = score >= 75 ? "Alta" : score >= 50 ? "Média" : "Baixa";
  if (compact) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 5 }} title={`Score: ${score}%`}>
        <div style={{ width: 28, height: 4, background: "var(--crm-surface-3)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${score}%`, height: "100%", background: color, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: 10.5, color: "var(--crm-text-3)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{score}%</span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 40, height: 4, background: "var(--crm-surface-3)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--crm-text-2)", fontWeight: 500 }}>{score}%</span>
      <span style={{ fontSize: 10.5, color, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
    </div>
  );
}

function SentimentDot({ sentiment, size = 6 }: { sentiment: UiLead["sentiment"]; size?: number }) {
  const color = sentiment === "positive" ? "var(--crm-positive)" : sentiment === "negative" ? "var(--crm-negative)" : "var(--crm-neutral-sent)";
  const label = sentiment === "positive" ? "Positivo" : sentiment === "negative" ? "Negativo" : "Neutro";
  return (
    <span title={`Sentimento: ${label}`} style={{
      width: size, height: size, borderRadius: "50%", background: color,
      display: "inline-block", flexShrink: 0,
    }} />
  );
}

function NextActionChip({ type, text }: { type: UiLead["nextActionType"]; text: string }) {
  const iconMap = { call: "phone", meet: "video", send: "send", qualify: "sparkle", wait: "clock", done: "check" } as const;
  const colorMap = {
    call: "var(--crm-stage-call)",
    meet: "var(--crm-stage-meet)",
    send: "var(--crm-accent)",
    qualify: "var(--crm-stage-ia)",
    wait: "var(--crm-text-3)",
    done: "var(--crm-success)",
  };
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 8px 3px 6px",
      background: "var(--crm-surface-2)",
      border: "1px solid var(--crm-border)",
      borderRadius: 5,
      fontSize: 11, color: "var(--crm-text-2)", fontWeight: 500,
      maxWidth: "100%", minWidth: 0,
    }}>
      <Icon name={iconMap[type] || "bolt"} size={11} style={{ color: colorMap[type], flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
    </div>
  );
}

export function LeadCard({
  lead,
  onClick,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  lead: UiLead;
  onClick: (lead: UiLead) => void;
  onDragStart: (e: ReactDragEvent<HTMLDivElement>, lead: UiLead) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const { density, showAiScore, showSentiment, showNextAction, showPreview, showAssignee, debugSources } = useTweaks();
  const isCompact = density === "compact";
  const isMedium = density === "medium";
  const dbg = debugSources;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead)}
      onDragEnd={onDragEnd}
      onClick={() => onClick(lead)}
      style={{
        background: "var(--crm-surface)",
        border: "1px solid var(--crm-border)",
        borderRadius: "var(--crm-radius)",
        padding: isCompact ? "10px 12px" : "12px 13px",
        cursor: "pointer",
        transition: "all 0.15s ease",
        boxShadow: isDragging ? "var(--crm-shadow-lg)" : "var(--crm-shadow-sm)",
        opacity: isDragging ? 0.5 : 1,
        transform: isDragging ? "rotate(1.5deg)" : "none",
        animation: "crm-slideUp 0.2s ease both",
        position: "relative",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--crm-border-strong)";
        e.currentTarget.style.boxShadow = "var(--crm-shadow-md)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--crm-border)";
        e.currentTarget.style.boxShadow = "var(--crm-shadow-sm)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Top row: name + value */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: isCompact ? 4 : 6 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {showSentiment && <SentimentDot sentiment={lead.sentiment} />}
            <span style={{
              fontSize: 13.5, fontWeight: 600,
              color: dbg ? "var(--crm-warning)" : "var(--crm-text)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              letterSpacing: "-0.01em",
              fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit",
            }}>{dbg ? DEBUG_SOURCES.name : lead.name}</span>
          </div>
          {!isCompact && (dbg || lead.company) && (
            <div style={{
              fontSize: 11.5,
              color: dbg ? "var(--crm-warning)" : "var(--crm-text-3)",
              marginTop: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit",
            }}>
              {dbg ? DEBUG_SOURCES.company : lead.company}
            </div>
          )}
          {!isCompact && lead.signupDate && (
            <div style={{
              fontSize: 10.5,
              color: dbg ? "var(--crm-warning)" : "var(--crm-text-4)",
              marginTop: 2,
              fontVariantNumeric: "tabular-nums",
              fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit",
            }}>
              {dbg ? DEBUG_SOURCES.signupDate : `Inscrito ${lead.signupDate}`}
            </div>
          )}
        </div>
      </div>

      {/* Preview da última mensagem */}
      {showPreview && !isCompact && (dbg || lead.lastMessage) && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px",
          background: "var(--crm-surface-2)",
          borderRadius: 6,
          marginBottom: 8,
          minWidth: 0,
        }}>
          <WhatsappIcon size={11} style={{ color: "#25d366", flexShrink: 0 }} />
          <span style={{
            fontSize: 11.5,
            color: dbg ? "var(--crm-warning)" : "var(--crm-text-2)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1, minWidth: 0,
            fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit",
          }}>{dbg ? DEBUG_SOURCES.lastMessage : lead.lastMessage}</span>
          <span style={{
            fontSize: 10.5,
            color: dbg ? "var(--crm-warning)" : "var(--crm-text-4)",
            flexShrink: 0, fontVariantNumeric: "tabular-nums",
            fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit",
          }}>
            {dbg ? "🔄 fmt" : lead.lastMessageTime}
          </span>
        </div>
      )}

      {/* Motivo do descarte (somente coluna descartado) */}
      {lead.stage === "descartado" && lead.descarteMotivo && !isCompact && (
        <div style={{
          marginBottom: 8,
          fontSize: 11,
          color: "var(--crm-text-muted)",
          padding: "4px 8px",
          background: "var(--crm-surface-2)",
          borderLeft: "2px solid var(--crm-stage-discarded)",
          borderRadius: 3,
          lineHeight: 1.35,
        }}>
          <span style={{ fontWeight: 600, color: "var(--crm-stage-discarded)" }}>Descarte:</span>{" "}
          {dbg ? DEBUG_SOURCES.descarteMotivo : lead.descarteMotivo}
        </div>
      )}

      {/* Próxima ação */}
      {showNextAction && !isCompact && (dbg || lead.nextAction) && (
        <div style={{ marginBottom: 8, display: "flex" }}>
          {dbg ? (
            <div style={{
              fontSize: 10.5,
              color: "var(--crm-warning)",
              fontFamily: "JetBrains Mono, monospace",
              padding: "3px 8px",
              background: "var(--crm-surface-2)",
              border: "1px solid var(--crm-warning)",
              borderRadius: 5,
              lineHeight: 1.3,
            }}>{DEBUG_SOURCES.nextAction}</div>
          ) : (
            <NextActionChip type={lead.nextActionType} text={lead.nextAction} />
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: isCompact ? 0 : 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {showAssignee && <Avatar memberId={lead.assignee} size={20} />}
          {lead.assignee === "ai" && !lead.aiPaused && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              fontSize: 10.5, color: "var(--crm-stage-ia)", fontWeight: 600,
              background: "#f3e8ff",
              padding: "2px 6px", borderRadius: 4,
              letterSpacing: "0.01em",
            }}>
              <Icon name="sparkle" size={10} />
              IA
            </span>
          )}
          {lead.aiPaused && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              fontSize: 10.5, color: "var(--crm-warning)", fontWeight: 600,
              background: "var(--crm-warning-soft)",
              padding: "2px 6px", borderRadius: 4,
              letterSpacing: "0.01em",
            }} title="IA pausada — humano assumiu">
              <Icon name="pause" size={10} />
              Humano
            </span>
          )}
          {/* Tags — próxima versão */}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {lead.unread > 0 && (
            <span style={{
              background: "var(--crm-accent)", color: "#fff",
              fontSize: 10.5, fontWeight: 600,
              padding: "1px 6px", borderRadius: 8,
              fontVariantNumeric: "tabular-nums",
              lineHeight: "16px", minWidth: 16,
              textAlign: "center",
            }}>{lead.unread}</span>
          )}
          {!isCompact && lead.lastMessageTime && (
            <span style={{ fontSize: 10.5, color: "var(--crm-text-4)", fontVariantNumeric: "tabular-nums" }}>
              {lead.lastMessageTime}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export { Tag, Avatar, AiScoreBar, SentimentDot, NextActionChip };
