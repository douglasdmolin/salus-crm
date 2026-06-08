"use client";

import { Icon } from "./Icon";
import { KIND_META, SECTIONS, type FieldExplanation } from "./debug-explanations";

export function DebugGlossaryModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 20, 25, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "crm-fadeIn 0.15s",
        zIndex: 110,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--crm-surface)",
          borderRadius: "var(--crm-radius-lg)",
          boxShadow: "var(--crm-shadow-xl)",
          width: "min(960px, 100%)",
          height: "min(85vh, 900px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "crm-slideUp 0.2s",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--crm-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--crm-surface-2)",
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
              Dicionário de dados do CRM
            </div>
            <div style={{ fontSize: 12, color: "var(--crm-text-3)", marginTop: 2 }}>
              De onde vem cada dado que você vê no kanban e no chat. Leitura leigo-friendly.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            style={{
              width: 34, height: 34,
              borderRadius: 8,
              color: "var(--crm-text-2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--crm-surface)",
              border: "1px solid var(--crm-border)",
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {/* Legenda */}
          <section style={{ marginBottom: 28 }}>
            <div style={{
              fontSize: 11.5,
              color: "var(--crm-text-3)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}>
              Legenda — cinco origens possíveis
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
            }}>
              {(Object.keys(KIND_META) as Array<keyof typeof KIND_META>).map((k) => {
                const m = KIND_META[k];
                return (
                  <div
                    key={k}
                    style={{
                      padding: 12,
                      background: "var(--crm-surface-2)",
                      border: "1px solid var(--crm-border)",
                      borderLeft: `3px solid ${m.color}`,
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontWeight: 600, fontSize: 13 }}>
                      <span style={{ fontSize: 16 }}>{m.emoji}</span>
                      <span style={{ color: m.color }}>{m.label}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--crm-text-2)", lineHeight: 1.55 }}>
                      {m.description}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sections */}
          {SECTIONS.map((sec, si) => (
            <section key={si} style={{ marginBottom: 32 }}>
              <div style={{
                paddingBottom: 8,
                marginBottom: 12,
                borderBottom: "2px solid var(--crm-border)",
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--crm-text)", letterSpacing: "-0.005em" }}>
                  {sec.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--crm-text-3)", marginTop: 3, lineHeight: 1.5 }}>
                  {sec.intro}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sec.fields.map((f, fi) => (
                  <FieldCard key={fi} field={f} />
                ))}
              </div>
            </section>
          ))}

          <div style={{
            padding: 14,
            background: "var(--crm-accent-soft)",
            border: "1px dashed var(--crm-accent)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--crm-accent)",
            lineHeight: 1.55,
          }}>
            <strong>Dica prática:</strong> Se um campo está como ⚠️ <strong>hardcoded</strong>, é sinal de que precisa virar coluna no banco antes da operação escalar. Se está como 🔄 <strong>derivado</strong> com reliability &quot;baixa&quot;, avalie se a regra está boa o suficiente pro uso — talvez precise de uma IA pra classificar em vez de regex.
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldCard({ field }: { field: FieldExplanation }) {
  const m = KIND_META[field.kind];
  const reliabilityColor =
    field.reliability === "alta" ? "var(--crm-success)" :
    field.reliability === "média" ? "var(--crm-warning)" :
    field.reliability === "baixa" ? "var(--crm-text-3)" :
    "var(--crm-danger)";

  return (
    <div
      style={{
        border: "1px solid var(--crm-border)",
        borderLeft: `3px solid ${m.color}`,
        borderRadius: 8,
        padding: 14,
        background: "var(--crm-surface)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15 }}>{m.emoji}</span>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{field.field}</div>
          <div style={{
            fontSize: 10.5,
            color: m.color,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "1px 6px",
            borderRadius: 4,
            background: "var(--crm-surface-2)",
          }}>
            {m.label}
          </div>
        </div>
        <div style={{
          fontSize: 10.5,
          color: reliabilityColor,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}>
          Confiabilidade: {field.reliability}
        </div>
      </div>

      {/* Origem */}
      <div style={{
        fontSize: 11.5,
        fontFamily: "JetBrains Mono, monospace",
        color: "var(--crm-text-2)",
        marginBottom: 8,
        padding: "4px 8px",
        background: "var(--crm-surface-2)",
        borderRadius: 5,
        display: "inline-block",
      }}>
        {field.origin}
        {field.sourceFile && <span style={{ color: "var(--crm-text-4)", marginLeft: 10 }}>· {field.sourceFile}</span>}
      </div>

      {/* Plain language */}
      <div style={{ fontSize: 12.5, color: "var(--crm-text)", lineHeight: 1.6, marginBottom: 8 }}>
        {field.plainLanguage}
      </div>

      {/* Example */}
      <div style={{
        fontSize: 11.5,
        color: "var(--crm-text-3)",
        fontStyle: "italic",
        padding: "6px 10px",
        borderLeft: "2px solid var(--crm-border)",
        marginBottom: field.notes ? 8 : 0,
      }}>
        Exemplo: {field.example}
      </div>

      {/* Notes */}
      {field.notes && (
        <div style={{
          fontSize: 11.5,
          color: "var(--crm-warning)",
          padding: "6px 10px",
          background: "var(--crm-warning-soft)",
          borderRadius: 5,
          lineHeight: 1.5,
        }}>
          <strong>Nota:</strong> {field.notes}
        </div>
      )}
    </div>
  );
}
