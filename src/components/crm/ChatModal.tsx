"use client";

import { useEffect, useState } from "react";
import { Icon, WhatsappIcon } from "./Icon";
import { TEAM_BY_ID, type UiLead } from "./ui-lead";
import { AiScoreBar, SentimentDot } from "./LeadCard";
import { useTweaks } from "./tweaks-store";
import { DEBUG_SOURCES } from "./debug-sources";

type Message = { direction: "in" | "out"; content: string; ts: string; author?: "ai" | "human" | "lead"; mediaUrl?: string; mediaType?: string };

type AiEvent = {
  id: number;
  created_at: string;
  event_type: string;
  stage: string | null;
  details: Record<string, unknown> | null;
};

const EVENT_ICON: Record<string, string> = {
  turn_start:     "🤖",
  turn_complete:  "✅",
  message_sent:   "💬",
  stage_changed:  "↗️",
  tool_called:    "🔧",
  error:          "❌",
};

const STAGE_LABELS: Record<string, string> = {
  novo:                       "Novo Contato",
  contato_respondido_pela_ia: "Respondeu",
  em_contato:                 "Aquecendo",
  ligacao_agendada:           "Agendado",
  call_agendada:              "Objeção",
  em_negociacao:              "Pós-visita",
  ganho:                      "Contato Futuro",
  contato_futuro:             "Contato Futuro",
  perdido:                    "Fechado",
  descartado:                 "Descartado",
};

function fmtEventLabel(ev: AiEvent): { title: string; sub: string | null } {
  const d = ev.details ?? {};
  switch (ev.event_type) {
    case "turn_start":
      return {
        title: "Sofia iniciou análise",
        sub: [
          STAGE_LABELS[ev.stage ?? ""] ?? ev.stage,
          d.model ? `· ${String(d.model).split("-")[1]}` : null,
        ].filter(Boolean).join(" "),
      };
    case "turn_complete":
      return {
        title: `Análise concluída · ${d.messages_sent ?? 0} msg${Number(d.messages_sent) !== 1 ? "s" : ""} enviada${Number(d.messages_sent) !== 1 ? "s" : ""}`,
        sub: d.duration_ms ? `${Math.round(Number(d.duration_ms) / 1000)}s` : null,
      };
    case "message_sent":
      return {
        title: "Mensagem enviada",
        sub: d.preview ? `"${String(d.preview).slice(0, 80)}${String(d.preview).length > 80 ? "…" : ""}"` : null,
      };
    case "stage_changed":
      return {
        title: "Etapa alterada",
        sub: `${STAGE_LABELS[String(d.from_stage ?? "")] ?? d.from_stage} → ${STAGE_LABELS[String(d.to_stage ?? "")] ?? d.to_stage}`,
      };
    case "tool_called":
      return { title: `Chamou: ${d.tool_name ?? ""}`, sub: null };
    case "error":
      return { title: "Erro", sub: d.message ? String(d.message) : null };
    default:
      return { title: ev.event_type, sub: null };
  }
}

function timeFmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function dateFmt(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoje";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/**
 * Checks if an optimistic message has been acknowledged by the server.
 * Match: same direction + same content + server ts within 2min of optimistic ts.
 */
function optimisticMatchesServer(opt: Message, server: Message[]): boolean {
  return server.some((srv) => {
    if (srv.direction !== opt.direction) return false;
    if (srv.content.trim() !== opt.content.trim()) return false;
    const optMs = new Date(opt.ts).getTime();
    const srvMs = new Date(srv.ts).getTime();
    return Math.abs(srvMs - optMs) < 120_000;
  });
}

export function ChatModal({ lead: initialLead, onClose }: { lead: UiLead; onClose: () => void }) {
  const [lead, setLead] = useState<UiLead>(initialLead);
  const [serverMessages, setServerMessages] = useState<Message[] | null>(null);
  const [pendingOptimistic, setPendingOptimistic] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [aiPaused, setAiPaused] = useState<boolean>(initialLead.aiPaused);
  const [togglingAi, setTogglingAi] = useState(false);
  const [aiEvents, setAiEvents] = useState<AiEvent[]>([]);
  const { debugSources: dbg } = useTweaks();

  // Poll AI events every 4s
  useEffect(() => {
    let mounted = true;
    const fetch_ = () => {
      fetch(`/api/leads/${initialLead.id}/ai-log`)
        .then((r) => r.json())
        .then((d) => { if (mounted) setAiEvents(d.events ?? []); })
        .catch(() => {});
    };
    fetch_();
    const iv = setInterval(fetch_, 4000);
    return () => { mounted = false; clearInterval(iv); };
  }, [initialLead.id]);

  // Poll the lead itself every 3s so sentiment/role/company/aiPaused reflect DB changes
  useEffect(() => {
    let mounted = true;
    const fetchLead = async () => {
      try {
        const r = await fetch(`/api/leads/${initialLead.id}`);
        if (!r.ok) return;
        const d = await r.json();
        if (!mounted || !d.lead) return;
        setLead(d.lead);
        setAiPaused(d.lead.aiPaused);
      } catch {}
    };
    const iv = setInterval(fetchLead, 5000);
    return () => { mounted = false; clearInterval(iv); };
  }, [initialLead.id]);
  const dbgStyle = {
    color: "var(--crm-warning)",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 11,
    lineHeight: 1.4,
  } as const;

  // Merge server truth with optimistic entries that haven't been acknowledged yet
  const messages: Message[] | null =
    serverMessages === null
      ? null
      : [...serverMessages, ...pendingOptimistic.filter((opt) => !optimisticMatchesServer(opt, serverMessages))]
          .sort((a, b) => a.ts.localeCompare(b.ts));

  useEffect(() => {
    let mounted = true;
    const refetch = () => {
      fetch(`/api/leads/${lead.id}/messages`)
        .then((r) => r.json())
        .then((d) => {
          if (!mounted) return;
          const srv = d.messages as Message[];
          setServerMessages(srv);
          // Clean up acknowledged optimistics
          setPendingOptimistic((prev) => prev.filter((opt) => !optimisticMatchesServer(opt, srv)));
        })
        .catch(() => { if (mounted && serverMessages === null) setServerMessages([]); });
    };

    refetch();
    const poll = setInterval(refetch, 5000);
    return () => { mounted = false; clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  async function handleSend() {
    const texto = draft.trim();
    if (!texto || sending) return;
    setSending(true);
    setSendError(null);
    const optimistic: Message = { direction: "out", content: texto, ts: new Date().toISOString() };
    setPendingOptimistic((prev) => [...prev, optimistic]);
    setDraft("");
    try {
      const r = await fetch(`/api/leads/${lead.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setSendError(body.error ?? `HTTP ${r.status}`);
        setPendingOptimistic((prev) => prev.filter((m) => m !== optimistic));
        setDraft(texto);
      } else {
        const body = await r.json().catch(() => ({}));
        if (body.ai_paused === true) setAiPaused(true);
        // Immediately refetch so the real server entry replaces the optimistic
        fetch(`/api/leads/${lead.id}/messages`)
          .then((r) => r.json())
          .then((d) => {
            const srv = d.messages as Message[];
            setServerMessages(srv);
            setPendingOptimistic((prev) => prev.filter((opt) => !optimisticMatchesServer(opt, srv)));
          })
          .catch(() => {});
      }
    } catch (err) {
      setSendError(String(err));
      setPendingOptimistic((prev) => prev.filter((m) => m !== optimistic));
      setDraft(texto);
    } finally {
      setSending(false);
    }
  }

  async function handleToggleAi() {
    if (togglingAi) return;
    setTogglingAi(true);
    const next = !aiPaused;
    setAiPaused(next); // optimistic
    try {
      const r = await fetch(`/api/leads/${lead.id}/ai-toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
      if (!r.ok) setAiPaused(!next); // revert
    } catch {
      setAiPaused(!next);
    } finally {
      setTogglingAi(false);
    }
  }

  // Group messages by day
  const groups: { date: string; items: Message[] }[] = [];
  for (const m of messages ?? []) {
    const key = dateFmt(m.ts);
    const last = groups[groups.length - 1];
    if (last && last.date === key) last.items.push(m);
    else groups.push({ date: key, items: [m] });
  }

  const assignee = TEAM_BY_ID[lead.assignee];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 20, 25, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "crm-fadeIn 0.15s",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--crm-surface)",
          borderRadius: "var(--crm-radius-lg)",
          boxShadow: "var(--crm-shadow-xl)",
          width: "min(1100px, 100%)",
          height: "min(700px, 90vh)",
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          animation: "crm-slideUp 0.2s",
          overflow: "hidden",
        }}
      >
        {/* LEFT — Chat */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, height: "100%", overflow: "hidden", borderRight: "1px solid var(--crm-border)" }}>
          {/* Chat header */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--crm-border)",
            gap: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <WhatsappIcon size={18} style={{ color: "#25d366" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {lead.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontFamily: "JetBrains Mono, monospace" }}>
                  {lead.phone}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={handleToggleAi}
                disabled={togglingAi}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: aiPaused ? "var(--crm-warning-soft)" : "var(--crm-accent-soft)",
                  color: aiPaused ? "var(--crm-warning)" : "var(--crm-accent)",
                  border: `1px solid ${aiPaused ? "var(--crm-warning)" : "var(--crm-accent)"}`,
                  cursor: togglingAi ? "wait" : "pointer",
                  opacity: togglingAi ? 0.7 : 1,
                }}
                title={aiPaused ? "Retomar resposta automática da IA" : "Pausar IA e assumir a conversa"}
              >
                <Icon name={aiPaused ? "play" : "pause"} size={11} />
                {aiPaused ? "Retomar IA" : "Pausar IA"}
              </button>
              <button
                onClick={onClose}
                style={{
                  padding: 6, borderRadius: 6,
                  color: "var(--crm-text-3)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                aria-label="Fechar"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>

          {aiPaused && (
            <div style={{
              padding: "6px 16px",
              background: "var(--crm-warning-soft)",
              color: "var(--crm-warning)",
              fontSize: 11.5,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderBottom: "1px solid var(--crm-border)",
            }}>
              <Icon name="pause" size={12} />
              IA pausada — você está no controle desta conversa.
            </div>
          )}

          {/* Messages */}
          <div style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 24px",
            background: "#faf9f6",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}>
            {messages === null && (
              <div style={{ textAlign: "center", color: "var(--crm-text-4)", padding: 20, fontSize: 12 }}>
                Carregando conversa...
              </div>
            )}
            {messages?.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--crm-text-4)", padding: 40, fontSize: 12 }}>
                Nenhuma mensagem ainda. A IA vai iniciar o contato em instantes.
              </div>
            )}
            {groups.map((group, gi) => (
              <div key={gi}>
                <div style={{
                  textAlign: "center",
                  margin: "8px 0",
                  fontSize: 10.5, color: "var(--crm-text-3)",
                  background: "var(--crm-surface)",
                  display: "inline-block",
                  padding: "3px 10px",
                  borderRadius: 10,
                  textTransform: "uppercase",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  position: "relative",
                  left: "50%",
                  transform: "translateX(-50%)",
                }}>
                  {group.date}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                  {group.items.map((m, i) => {
                    const isOut = m.direction === "out";
                    const isAi = m.author === "ai";
                    const isHuman = m.author === "human";
                    const prev = i > 0 ? group.items[i - 1] : null;
                    const showAuthorLabel =
                      isOut && (!prev || prev.direction !== "out" || prev.author !== m.author);
                    const bubbleBg = isAi ? "#ede9fe" : isHuman ? "#dcfce7" : "var(--crm-surface)";
                    return (
                      <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isOut ? "flex-end" : "flex-start" }}>
                        {showAuthorLabel && (
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            marginBottom: 3,
                            fontSize: 10.5,
                            fontWeight: 600,
                            color: isAi ? "var(--crm-stage-ia)" : "var(--crm-accent)",
                            letterSpacing: "0.02em",
                          }}>
                            <Icon name={isAi ? "sparkle" : "user"} size={11} />
                            {isAi ? "Assistente IA" : lead.assignee === "closer" ? "Você" : "Operador"}
                          </div>
                        )}
                        <div style={{
                          maxWidth: "70%",
                          background: bubbleBg,
                          border: isOut ? "none" : "1px solid var(--crm-border)",
                          borderRadius: 10,
                          padding: "8px 12px",
                          fontSize: 13.5,
                          color: "var(--crm-text)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          boxShadow: "var(--crm-shadow-sm)",
                        }}>
                          {m.mediaUrl && (
                            <div style={{ marginBottom: m.content ? 6 : 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 600, color: "var(--crm-text-3)", marginBottom: 3 }}>
                                <Icon name="mic" size={11} /> Áudio
                              </div>
                              <audio controls preload="none" src={m.mediaUrl} style={{ maxWidth: "100%", height: 34 }} />
                              {m.content && <div style={{ fontSize: 11.5, fontStyle: "italic", color: "var(--crm-text-3)", marginTop: 4 }}>“{m.content}”</div>}
                            </div>
                          )}
                          {!m.mediaUrl && m.content}
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 4,
                            marginTop: 3,
                            fontSize: 10,
                            color: "var(--crm-text-3)",
                          }}>
                            {timeFmt(m.ts)}
                            {isOut && (
                              <Icon name="checkDouble" size={12} style={{ color: "var(--crm-accent)" }} />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Send bar — human can send directly */}
          <div style={{
            borderTop: "1px solid var(--crm-border)",
            background: "var(--crm-surface-2)",
            padding: "10px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}>
            {sendError && (
              <div style={{
                fontSize: 11,
                color: "var(--crm-danger)",
                background: "var(--crm-danger-soft)",
                padding: "4px 8px",
                borderRadius: 5,
              }}>
                Falha ao enviar: {sendError}
              </div>
            )}
            <div style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              background: "var(--crm-surface)",
              border: "1px solid var(--crm-border)",
              borderRadius: 10,
              padding: "6px 10px",
            }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Responder como closer (envia no WhatsApp direto)..."
                rows={1}
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  resize: "none",
                  background: "transparent",
                  fontSize: 13.5,
                  fontFamily: "inherit",
                  color: "var(--crm-text)",
                  minHeight: 22,
                  maxHeight: 100,
                  padding: "4px 0",
                }}
              />
              <button
                onClick={handleSend}
                disabled={sending || !draft.trim()}
                style={{
                  background: draft.trim() && !sending ? "var(--crm-accent)" : "var(--crm-surface-3)",
                  color: draft.trim() && !sending ? "#fff" : "var(--crm-text-4)",
                  padding: "7px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  cursor: draft.trim() && !sending ? "pointer" : "not-allowed",
                  transition: "all 0.15s",
                }}
              >
                <Icon name="send" size={12} />
                {sending ? "Enviando..." : "Enviar"}
              </button>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--crm-text-3)", display: "flex", alignItems: "center", gap: 5 }}>
              <Icon name={aiPaused ? "pause" : "ai"} size={10} style={{ color: aiPaused ? "var(--crm-warning)" : "var(--crm-stage-ia)" }} />
              {aiPaused
                ? "IA pausada. Mensagens daqui vão direto pro WhatsApp."
                : "Enviar mensagem humana pausa a IA automaticamente."}
            </div>
          </div>
        </div>

        {/* RIGHT — Lead panel */}
        <div style={{
          padding: "16px 18px",
          overflowY: "auto",
          background: "var(--crm-surface-2)",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              Lead
            </div>
            <div style={{
              fontSize: dbg ? 11 : 16,
              fontWeight: 600,
              color: dbg ? "var(--crm-warning)" : "var(--crm-text)",
              fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit",
            }}>{dbg ? DEBUG_SOURCES.name : lead.name}</div>
            {(dbg || lead.role) && (
              <div style={{ fontSize: 12, color: dbg ? "var(--crm-warning)" : "var(--crm-text-2)", marginTop: 2, fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit" }}>
                {dbg ? DEBUG_SOURCES.role : lead.role}
              </div>
            )}
            {(dbg || lead.company) && (
              <div style={{ fontSize: 12, color: dbg ? "var(--crm-warning)" : "var(--crm-text-3)", marginTop: 2, display: "flex", alignItems: "center", gap: 5, fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit" }}>
                <Icon name="building" size={11} />{dbg ? DEBUG_SOURCES.company : lead.company}
              </div>
            )}
            {lead.signupDate && (
              <div style={{ fontSize: 11, color: dbg ? "var(--crm-warning)" : "var(--crm-text-4)", marginTop: 4, fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit", fontVariantNumeric: "tabular-nums" }}>
                {dbg ? DEBUG_SOURCES.signupDate : `Inscrito em ${lead.signupDate}`}
              </div>
            )}
          </div>

          {lead.stage === "descartado" && lead.descarteMotivo && (
            <div>
              <div style={{ fontSize: 11, color: "var(--crm-stage-discarded)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Motivo do descarte
              </div>
              <div style={{
                fontSize: 12.5, color: "var(--crm-text)", lineHeight: 1.5,
                padding: "8px 12px", background: "var(--crm-surface-2)",
                borderLeft: "3px solid var(--crm-stage-discarded)", borderRadius: 4,
              }}>
                {dbg ? DEBUG_SOURCES.descarteMotivo : lead.descarteMotivo}
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Sentimento
            </div>
            {dbg ? (
              <div style={dbgStyle}>{DEBUG_SOURCES.sentiment}</div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <SentimentDot sentiment={lead.sentiment} size={8} />
                {lead.sentiment === "positive" ? "Positivo" : lead.sentiment === "negative" ? "Negativo" : "Neutro"}
              </div>
            )}
          </div>

          {(dbg || lead.aiSummary) && (
            <div>
              <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Resumo
              </div>
              <div style={{
                fontSize: dbg ? 11 : 12.5,
                color: dbg ? "var(--crm-warning)" : "var(--crm-text)",
                lineHeight: 1.5,
                fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit",
              }}>{dbg ? DEBUG_SOURCES.aiSummary : lead.aiSummary}</div>
            </div>
          )}

          {(dbg || lead.nextAction) && (
            <div>
              <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Próxima ação
              </div>
              <div style={{
                fontSize: dbg ? 11 : 12.5,
                color: dbg ? "var(--crm-warning)" : "var(--crm-text)",
                fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit",
              }}>{dbg ? DEBUG_SOURCES.nextAction : lead.nextAction}</div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Contato
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 12,
              color: dbg ? "var(--crm-warning)" : "var(--crm-text-2)",
              fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit",
            }}>
              <WhatsappIcon size={12} style={{ color: "#25d366" }} /> {dbg ? DEBUG_SOURCES.phone : lead.phone}
            </div>
            {(dbg || lead.email) && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 12,
                color: dbg ? "var(--crm-warning)" : "var(--crm-text-2)",
                marginTop: 4,
                fontFamily: dbg ? "JetBrains Mono, monospace" : "inherit",
              }}>
                <Icon name="mail" size={12} /> {dbg ? DEBUG_SOURCES.email : lead.email}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Responsável
            </div>
            {dbg ? (
              <div style={dbgStyle}>{DEBUG_SOURCES.assignee}</div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: "50%",
                  background: assignee?.color || "#94a3b8",
                  color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 600,
                }}>
                  {assignee?.initials || "?"}
                </div>
                <div>
                  <div style={{ fontWeight: 500 }}>{assignee?.name || "—"}</div>
                  {assignee?.isAi && <div style={{ fontSize: 10, color: "var(--crm-stage-ia)" }}>Automático</div>}
                </div>
              </div>
            )}
          </div>

          <div>
            <div style={{
              fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8,
            }}>
              Tags
              {lead.leadTags.length > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 500, textTransform: "none", letterSpacing: 0,
                  padding: "1px 6px", background: "var(--crm-surface-3)",
                  color: "var(--crm-text-3)", borderRadius: 10, marginLeft: 6,
                }}>{lead.leadTags.length}</span>
              )}
            </div>
            {lead.leadTags.length === 0 ? (
              <div style={{ fontSize: 11.5, color: "var(--crm-text-4)", fontStyle: "italic" }}>
                Nenhuma tag ainda — Sofia vai adicionando conforme a conversa avança.
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {lead.leadTags.map((t, i) => {
                  const CAT_COLORS: Record<string, { bg: string; color: string }> = {
                    dor:     { bg: "#fef2f2", color: "#dc2626" },
                    familia: { bg: "#eff6ff", color: "#2563eb" },
                    imovel:  { bg: "#f9fafb", color: "#4b5563" },
                    decisao: { bg: "#f5f3ff", color: "#7c3aed" },
                    icp:     { bg: "#ecfdf5", color: "#059669" },
                    sinal:   { bg: "#fffbeb", color: "#d97706" },
                  };
                  const style = CAT_COLORS[t.categoria] ?? { bg: "var(--crm-surface-3)", color: "var(--crm-text-2)" };
                  const label = t.tag.replace(/^(dor_|icp_)/, "").replace(/_/g, " ");
                  return (
                    <span key={i} title={t.valor ?? t.tag} style={{
                      fontSize: 10.5, fontWeight: 500, padding: "2px 8px",
                      borderRadius: 10, background: style.bg, color: style.color,
                      border: `1px solid ${style.color}22`,
                    }}>
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div style={{
              fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.05em",
              marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
            }}>
              Origem
              <span style={{
                fontSize: 9, fontWeight: 500, textTransform: "none", letterSpacing: 0,
                padding: "1px 6px", background: "var(--crm-surface-3)",
                color: "var(--crm-text-3)", borderRadius: 10,
              }}>próxima versão</span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--crm-text-2)" }}>
              formulário
            </div>
          </div>

          {/* AI Process Log */}
          <div>
            <div style={{
              fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.05em",
              marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
            }}>
              Processo da IA
              {aiEvents.length > 0 && aiEvents[aiEvents.length - 1]?.event_type === "turn_start" && (
                <span style={{
                  fontSize: 9, fontWeight: 600, textTransform: "none", letterSpacing: 0,
                  padding: "1px 8px", background: "#ede9fe",
                  color: "#7c3aed", borderRadius: 10, animation: "crm-pulse 1.5s infinite",
                }}>● processando</span>
              )}
            </div>

            {aiEvents.length === 0 ? (
              <div style={{ fontSize: 11.5, color: "var(--crm-text-4)", fontStyle: "italic" }}>
                Nenhuma atividade ainda.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {aiEvents.slice(-12).map((ev) => {
                  const { title, sub } = fmtEventLabel(ev);
                  const icon = EVENT_ICON[ev.event_type] ?? "•";
                  const ts = new Date(ev.created_at).toLocaleTimeString("pt-BR", {
                    hour: "2-digit", minute: "2-digit", second: "2-digit",
                  });
                  const isLast = ev === aiEvents[aiEvents.length - 1];
                  return (
                    <div key={ev.id} style={{
                      display: "flex", gap: 6, alignItems: "flex-start",
                      padding: "4px 6px", borderRadius: 5,
                      background: isLast ? "var(--crm-accent-soft)" : "transparent",
                      transition: "background 0.3s",
                    }}>
                      <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 11.5, fontWeight: 500,
                          color: isLast ? "var(--crm-accent)" : "var(--crm-text)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {title}
                        </div>
                        {sub && (
                          <div style={{
                            fontSize: 10.5, color: "var(--crm-text-3)", marginTop: 1,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {sub}
                          </div>
                        )}
                      </div>
                      <span style={{
                        fontSize: 9.5, color: "var(--crm-text-4)", flexShrink: 0,
                        fontVariantNumeric: "tabular-nums", marginTop: 2,
                      }}>{ts}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {dbg && (
            <div style={{
              marginTop: 12,
              padding: 10,
              background: "var(--crm-warning-soft)",
              border: "1px dashed var(--crm-warning)",
              borderRadius: 8,
              fontSize: 10.5,
              color: "var(--crm-warning)",
              lineHeight: 1.5,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Legenda</div>
              <div>📊 direto de coluna da tabela</div>
              <div>🔄 derivado por lógica JS</div>
              <div>🔗 join / denormalized</div>
              <div>⚠️ hardcoded ou mockado</div>
              <div>⚙️ config (arquivo TS)</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
