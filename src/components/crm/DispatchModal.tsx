"use client";

import { useState, useEffect } from "react";

type Result = {
  ok: true;
  runId: string;
  leadCount: number;
  intervalSeconds: number;
  estimatedDurationMinutes: number;
  leads: Array<{ id: string; name: string }>;
};

const BATCH_SIZES = [10, 20, 30] as const;
const INTERVALS = [
  { seconds: 90, label: "Lento (90s)", risk: "🟢 Mais seguro" },
  { seconds: 60, label: "Médio (60s)", risk: "🟡 Recomendado" },
  { seconds: 30, label: "Rápido (30s)", risk: "🔴 Risco moderado" },
] as const;

export function DispatchModal({
  open,
  eligibleCount,
  onClose,
  onDispatched,
}: {
  open: boolean;
  eligibleCount: number;
  onClose: () => void;
  onDispatched: () => void;
}) {
  const [batchSize, setBatchSize] = useState<number>(20);
  const [intervalSeconds, setIntervalSeconds] = useState<number>(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const effectiveBatch = Math.min(batchSize, eligibleCount);
  const totalSeconds = (effectiveBatch - 1) * intervalSeconds;
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));

  async function handleDispatch() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/dispatches/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize, intervalSeconds }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setResult(j as Result);
      onDispatched();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--crm-surface)", borderRadius: 12,
          padding: 24, width: "min(520px, 92vw)", maxHeight: "90vh", overflow: "auto",
          border: "1px solid var(--crm-border)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--crm-text)" }}>
            ⚡ Disparo em massa
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--crm-text-3)", fontSize: 18 }}>×</button>
        </div>

        {result ? (
          <div>
            <div style={{
              padding: 12, background: "var(--crm-success-soft)", border: "1px solid var(--crm-success)",
              borderRadius: 8, color: "var(--crm-success)", fontSize: 13, marginBottom: 14,
            }}>
              ✓ Disparo iniciado. <strong>{result.leadCount} leads</strong> em ~{result.estimatedDurationMinutes} min.
              <div style={{ fontSize: 11, marginTop: 6, color: "var(--crm-text-3)" }}>
                Run id: <code style={{ fontFamily: "JetBrains Mono, monospace" }}>{result.runId}</code>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--crm-text-3)", marginBottom: 8 }}>
              Os cards de <strong>Novo Contato</strong> e <strong>Lead Contatado</strong> (sem workflow ativo) serão processados e moverão para <strong>Lead Contatado</strong> conforme cada disparo é enviado.
            </div>
            <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--crm-border)", borderRadius: 6, padding: 8 }}>
              {result.leads.map((l) => (
                <div key={l.id} style={{ fontSize: 12, color: "var(--crm-text-2)", padding: "3px 0", borderBottom: "1px solid var(--crm-border)" }}>
                  {l.name}
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              style={{
                marginTop: 16, width: "100%", padding: "10px 16px",
                background: "var(--crm-accent)", color: "white", border: "none",
                borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13,
              }}
            >Fechar</button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>
                Tamanho do lote ({eligibleCount} disponíveis para disparo)
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {BATCH_SIZES.map((n) => (
                  <button
                    key={n}
                    onClick={() => setBatchSize(n)}
                    disabled={n > eligibleCount}
                    style={{
                      flex: 1, padding: "10px 8px", borderRadius: 6,
                      border: batchSize === n ? "2px solid var(--crm-accent)" : "1px solid var(--crm-border)",
                      background: batchSize === n ? "var(--crm-accent-soft)" : "var(--crm-surface-2)",
                      color: n > eligibleCount ? "var(--crm-text-4)" : "var(--crm-text)",
                      cursor: n > eligibleCount ? "not-allowed" : "pointer",
                      fontWeight: 600, fontSize: 14,
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>
                Intervalo entre disparos
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {INTERVALS.map((opt) => (
                  <button
                    key={opt.seconds}
                    onClick={() => setIntervalSeconds(opt.seconds)}
                    style={{
                      padding: "10px 12px", borderRadius: 6,
                      border: intervalSeconds === opt.seconds ? "2px solid var(--crm-accent)" : "1px solid var(--crm-border)",
                      background: intervalSeconds === opt.seconds ? "var(--crm-accent-soft)" : "var(--crm-surface-2)",
                      color: "var(--crm-text)",
                      cursor: "pointer", fontSize: 13,
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{opt.label}</span>
                    <span style={{ fontSize: 11, color: "var(--crm-text-3)" }}>{opt.risk}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{
              padding: 12, background: "var(--crm-surface-2)", borderRadius: 6,
              fontSize: 12.5, color: "var(--crm-text-2)", marginBottom: 16,
            }}>
              <div><strong>Resumo:</strong> {effectiveBatch} leads × {intervalSeconds}s</div>
              <div>Tempo total estimado: <strong>~{totalMinutes} min</strong></div>
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--crm-text-3)" }}>
                Os leads são selecionados em ordem cronológica (mais antigos primeiro). O workflow Vercel é durável e não tem timeout.
              </div>
            </div>

            {error && (
              <div style={{ padding: 8, background: "var(--crm-danger-soft)", color: "var(--crm-danger)", borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
                Erro: {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={onClose}
                disabled={submitting}
                style={{
                  flex: 1, padding: "10px 16px", borderRadius: 6,
                  background: "var(--crm-surface-2)", color: "var(--crm-text)",
                  border: "1px solid var(--crm-border)", cursor: "pointer", fontSize: 13,
                }}
              >Cancelar</button>
              <button
                onClick={handleDispatch}
                disabled={submitting || effectiveBatch === 0}
                style={{
                  flex: 2, padding: "10px 16px", borderRadius: 6,
                  background: "var(--crm-accent)", color: "white",
                  border: "none", cursor: submitting ? "wait" : "pointer", fontWeight: 600, fontSize: 13,
                }}
              >{submitting ? "Iniciando..." : `⚡ Disparar ${effectiveBatch} leads`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
