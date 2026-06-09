"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AllowedModel = { id: string; label: string };

type KanbanStageRow = {
  id: string; label: string; short: string; color: string;
  description: string; owner: "ia" | "human"; position: number; is_active: boolean;
  system_prompt: string | null; ai_model: string | null; ai_enabled: boolean;
};

type ConfigResponse = {
  prompt: string;
  model: string;
  temperature: number;
  defaultPrompt: string;
  allowedModels: AllowedModel[];
  uazapiUrl: string | null;
  uazapiInstance: string | null;
  uazapiTokenSet: boolean;
  notificationPhone: string;
  gcalCalendarId: string;
  gcalClientEmail: string;
  gcalPrivateKeySet: boolean;
};

type WhatsappStatus = {
  ok: boolean;
  status?: string;
  profileName?: string | null;
  profilePicUrl?: string | null;
  isBusiness?: boolean;
  name?: string | null;
  hasQrCode?: boolean;
  error?: string;
};

type DispatchCfg = {
  enabled: boolean;
  mode: "all" | "whitelist";
  whitelistPhones: string[];
};

type AnthropicCredits = {
  ok: boolean;
  spentUsd?: number;
  baselineUsd?: number | null;
  baselineAt?: string | null;
  remainingUsd?: number | null;
  byDay?: Array<{ day: string; usd: number }>;
  note?: string;
  error?: string;
};

export default function ConfigPage() {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(1.0);
  const [waStatus, setWaStatus] = useState<WhatsappStatus | null>(null);
  const [credits, setCredits] = useState<AnthropicCredits | null>(null);
  const [baselineInput, setBaselineInput] = useState<string>("");
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [dispatch, setDispatch] = useState<DispatchCfg | null>(null);
  const [whitelistText, setWhitelistText] = useState<string>("");
  const [savingDispatch, setSavingDispatch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [uazapiUrl, setUazapiUrl] = useState("");
  const [uazapiInstance, setUazapiInstance] = useState("");
  const [uazapiToken, setUazapiToken] = useState("");
  const [uazapiTokenSet, setUazapiTokenSet] = useState(false);
  const [showUazapiToken, setShowUazapiToken] = useState(false);
  const [notificationPhone, setNotificationPhone] = useState("");
  const [savingUazapi, setSavingUazapi] = useState(false);
  const [testingConn, setTestingConn] = useState(false);

  // Google Calendar
  const [gcalCalendarId, setGcalCalendarId] = useState("");
  const [gcalClientEmail, setGcalClientEmail] = useState("");
  const [gcalPrivateKey, setGcalPrivateKey] = useState("");
  const [gcalPrivateKeySet, setGcalPrivateKeySet] = useState(false);
  const [showGcalKey, setShowGcalKey] = useState(false);
  const [savingGcal, setSavingGcal] = useState(false);

  // Etapas do kanban
  const [stages, setStages] = useState<KanbanStageRow[]>([]);
  const [editingStage, setEditingStage] = useState<KanbanStageRow | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<KanbanStageRow | null>(null);
  const [newStage, setNewStage] = useState<{ id: string; label: string; short: string; color: string; owner: "ia" | "human" } | null>(null);
  const [savingStage, setSavingStage] = useState(false);
  const [stageErr, setStageErr] = useState<string | null>(null);

  async function loadStages() {
    const res = await fetch("/api/stages").catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setStages(Array.isArray(data) ? data : []);
  }

  async function saveStage(s: KanbanStageRow) {
    setSavingStage(true); setStageErr(null);
    try {
      const res = await fetch(`/api/stages/${s.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: s.label, short: s.short, color: s.color, owner: s.owner }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setStages((prev) => prev.map((x) => (x.id === s.id ? j : x)));
      setEditingStage(null);
    } catch (e) { setStageErr((e as Error).message); }
    finally { setSavingStage(false); }
  }

  async function saveStagePrompt(s: KanbanStageRow) {
    setSavingStage(true); setStageErr(null);
    try {
      const res = await fetch(`/api/stages/${s.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_prompt: s.system_prompt || null,
          ai_model: s.ai_model,
          ai_enabled: s.ai_enabled,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setStages((prev) => prev.map((x) => (x.id === s.id ? j : x)));
      setEditingPrompt(null);
    } catch (e) { setStageErr((e as Error).message); }
    finally { setSavingStage(false); }
  }

  async function toggleStage(s: KanbanStageRow) {
    setSavingStage(true); setStageErr(null);
    try {
      const method = s.is_active ? "DELETE" : "PUT";
      const body = s.is_active ? undefined : JSON.stringify({ is_active: true });
      const res = await fetch(`/api/stages/${s.id}`, {
        method, headers: body ? { "Content-Type": "application/json" } : {}, body,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setStages((prev) => prev.map((x) => (x.id === s.id ? j : x)));
    } catch (e) { setStageErr((e as Error).message); }
    finally { setSavingStage(false); }
  }

  async function deleteStage(s: KanbanStageRow) {
    if (!confirm(`Excluir permanentemente a etapa "${s.label}"? Esta ação não pode ser desfeita.`)) return;
    setSavingStage(true); setStageErr(null);
    try {
      const res = await fetch(`/api/stages/${s.id}?permanent=true`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setStages((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) { setStageErr((e as Error).message); }
    finally { setSavingStage(false); }
  }

  async function moveStage(id: string, dir: -1 | 1) {
    const idx = stages.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[idx], next[target]] = [next[target], next[idx]];
    setStages(next);
    await Promise.all([
      fetch(`/api/stages/${next[idx].id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ position: idx }) }),
      fetch(`/api/stages/${next[target].id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ position: target }) }),
    ]);
  }

  async function createStage() {
    if (!newStage) return;
    setSavingStage(true); setStageErr(null);
    try {
      const res = await fetch("/api/stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newStage),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setStages((prev) => [...prev, j]);
      setNewStage(null);
    } catch (e) { setStageErr((e as Error).message); }
    finally { setSavingStage(false); }
  }

  async function load() {
    setErr(null);
    try {
      const [cfgRes, waRes, crRes, dispRes] = await Promise.all([
        fetch("/api/config", { cache: "no-store" }),
        fetch("/api/whatsapp/status", { cache: "no-store" }),
        fetch("/api/anthropic/credits", { cache: "no-store" }),
        fetch("/api/dispatch-config", { cache: "no-store" }),
      ]);
      if (!cfgRes.ok) throw new Error(`config HTTP ${cfgRes.status}`);
      const c = (await cfgRes.json()) as ConfigResponse;
      setCfg(c);
      setPrompt(c.prompt);
      setModel(c.model);
      setTemperature(c.temperature);
      setUazapiUrl(c.uazapiUrl ?? "");
      setUazapiInstance(c.uazapiInstance ?? "");
      setUazapiTokenSet(c.uazapiTokenSet);
      setNotificationPhone(c.notificationPhone ?? "");
      setGcalCalendarId(c.gcalCalendarId ?? "");
      setGcalClientEmail(c.gcalClientEmail ?? "");
      setGcalPrivateKeySet(c.gcalPrivateKeySet ?? false);
      setWaStatus((await waRes.json()) as WhatsappStatus);
      const cr = (await crRes.json()) as AnthropicCredits;
      setCredits(cr);
      if (cr.baselineUsd != null) setBaselineInput(String(cr.baselineUsd));
      const dc = (await dispRes.json()) as DispatchCfg;
      setDispatch(dc);
      setWhitelistText(dc.whitelistPhones.join("\n"));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function saveDispatch(next: Partial<DispatchCfg>) {
    if (!dispatch) return;
    setSavingDispatch(true);
    setErr(null);
    try {
      const body = { ...next };
      if (next.whitelistPhones === undefined && whitelistText !== undefined) {
        // when toggling enabled/mode, also send the latest whitelist text
        body.whitelistPhones = whitelistText.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      }
      const res = await fetch("/api/dispatch-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setDispatch({ enabled: j.enabled, mode: j.mode, whitelistPhones: j.whitelistPhones });
      setWhitelistText(j.whitelistPhones.join("\n"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingDispatch(false);
    }
  }

  async function saveUazapi() {
    if (!uazapiUrl.startsWith("http")) {
      setErr("URL da Uazapi inválida — deve começar com http(s)://");
      return;
    }
    setSavingUazapi(true);
    setErr(null);
    try {
      const body: Record<string, string> = { uazapiUrl, uazapiInstance, notificationPhone };
      if (uazapiToken.trim()) body.uazapiToken = uazapiToken.trim();
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setUazapiToken("");
      setUazapiTokenSet(true);
      const waRes = await fetch("/api/whatsapp/status", { cache: "no-store" });
      setWaStatus((await waRes.json()) as WhatsappStatus);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingUazapi(false);
    }
  }

  async function saveGcal() {
    if (!gcalCalendarId.trim()) { setErr("Calendar ID é obrigatório"); return; }
    if (!gcalClientEmail.includes("@")) { setErr("Client email inválido"); return; }
    if (!gcalPrivateKey.trim() && !gcalPrivateKeySet) { setErr("Private key é obrigatória"); return; }
    setSavingGcal(true);
    setErr(null);
    try {
      const body: Record<string, string> = { gcalCalendarId, gcalClientEmail };
      if (gcalPrivateKey.trim()) body.gcalPrivateKey = gcalPrivateKey.trim();
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setGcalPrivateKey("");
      setGcalPrivateKeySet(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingGcal(false);
    }
  }

  async function testUazapiConn() {
    setTestingConn(true);
    try {
      const waRes = await fetch("/api/whatsapp/status", { cache: "no-store" });
      setWaStatus((await waRes.json()) as WhatsappStatus);
    } finally {
      setTestingConn(false);
    }
  }

  async function saveBaseline() {
    const usd = Number(baselineInput);
    if (!Number.isFinite(usd) || usd < 0) return;
    setSavingBaseline(true);
    setErr(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anthropicBaselineUsd: usd }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      // refresh credits
      const cr = await (await fetch("/api/anthropic/credits", { cache: "no-store" })).json();
      setCredits(cr as AnthropicCredits);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingBaseline(false);
    }
  }

  useEffect(() => {
    load();
    loadStages();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model, temperature }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function resetToDefault() {
    if (!cfg) return;
    if (!confirm("Substituir o prompt atual pelo padrão? (não salva ainda — você ainda pode revisar)")) return;
    setPrompt(cfg.defaultPrompt);
  }

  const wsBadge = waStatus?.status === "connected"
    ? { color: "var(--crm-success)", text: "Conectado", bg: "var(--crm-success-soft)" }
    : waStatus?.status === "connecting"
    ? { color: "var(--crm-warning)", text: "Conectando...", bg: "var(--crm-warning-soft)" }
    : waStatus?.status === "disconnected"
    ? { color: "var(--crm-danger)", text: "Desconectado", bg: "var(--crm-danger-soft)" }
    : { color: "var(--crm-text-3)", text: waStatus?.status ?? "Desconhecido", bg: "var(--crm-surface-2)" };

  return (
    <div style={{ minHeight: "100vh", background: "var(--crm-bg)", color: "var(--crm-text)" }}>
      <header
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 24px", borderBottom: "1px solid var(--crm-border)",
          background: "var(--crm-surface)", height: 56,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/crm" style={{ color: "var(--crm-text-2)", textDecoration: "none", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            ← Voltar
          </Link>
          <div style={{ width: 1, height: 20, background: "var(--crm-border)" }} />
          <div style={{ fontSize: 16, fontWeight: 700 }}>Configurações</div>
        </div>
        {savedAt && <div style={{ fontSize: 12, color: "var(--crm-success)" }}>✓ Salvo às {savedAt}</div>}
      </header>

      <main style={{ maxWidth: 920, margin: "0 auto", padding: "24px 20px 60px" }}>
        {err && (
          <div style={{ padding: 10, background: "var(--crm-danger-soft)", color: "var(--crm-danger)", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
            Erro: {err}
          </div>
        )}

        {/* Uazapi — conexão completa */}
        <section style={sectionStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 style={{ ...h2Style, marginBottom: 0 }}>Conexão Uazapi (WhatsApp)</h2>
            {waStatus && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
                background: wsBadge.bg, color: wsBadge.color, border: `1px solid ${wsBadge.color}`,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: wsBadge.color }} />
                {wsBadge.text}
                {waStatus.name && <span style={{ fontWeight: 400, opacity: 0.8 }}>· {waStatus.name}</span>}
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Row 1: Server URL + Instance */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Server URL</label>
                <input type="url" value={uazapiUrl}
                  onChange={(e) => setUazapiUrl(e.target.value)}
                  placeholder="https://free.uazapi.com"
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Nome da instância</label>
                <input type="text" value={uazapiInstance}
                  onChange={(e) => setUazapiInstance(e.target.value)}
                  placeholder="ex: ysl1Yl"
                  style={inputStyle} />
              </div>
            </div>

            {/* Row 1b: Número de notificação do coordenador */}
            <div>
              <label style={labelStyle}>
                Número de notificação do coordenador
                <span style={{ fontWeight: 400, color: "var(--crm-text-3)", marginLeft: 6 }}>
                  (recebe alertas de agendamento e leads quentes)
                </span>
              </label>
              <input
                type="tel"
                value={notificationPhone}
                onChange={(e) => setNotificationPhone(e.target.value)}
                placeholder="ex: 5592981951096 ou +55 92 98195-1096"
                style={{ ...inputStyle, fontFamily: "JetBrains Mono, monospace" }}
              />
            </div>

            {/* Row 2: Token */}
            <div>
              <label style={labelStyle}>
                Token da instância
                {uazapiTokenSet && !uazapiToken && (
                  <span style={{ fontWeight: 400, color: "var(--crm-success)", marginLeft: 8 }}>✓ configurado</span>
                )}
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type={showUazapiToken ? "text" : "password"}
                  value={uazapiToken}
                  onChange={(e) => setUazapiToken(e.target.value)}
                  placeholder={uazapiTokenSet ? "Deixe em branco para manter o token atual" : "Cole o token da instância aqui"}
                  style={{ ...inputStyle, flex: 1, fontFamily: "JetBrains Mono, monospace" }}
                />
                <button type="button" onClick={() => setShowUazapiToken((v) => !v)} style={btnSecondary}
                  title={showUazapiToken ? "Ocultar" : "Mostrar"}>
                  {showUazapiToken ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            {/* Row 3: Webhook URL (read-only) */}
            <div>
              <label style={labelStyle}>URL do Webhook <span style={{ fontWeight: 400, color: "var(--crm-text-3)" }}>(configure no painel Uazapi)</span></label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  readOnly
                  value={typeof window !== "undefined" ? `${window.location.origin}/api/uazapi/webhook` : "/api/uazapi/webhook"}
                  style={{ ...inputStyle, flex: 1, color: "var(--crm-text-3)", cursor: "default" }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const url = `${window.location.origin}/api/uazapi/webhook`;
                    navigator.clipboard.writeText(url).then(() => alert("URL copiada!"));
                  }}
                  style={btnSecondary}
                  title="Copiar URL do webhook"
                >
                  📋 Copiar
                </button>
              </div>
            </div>

            {/* Row 4: Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
              <button onClick={testUazapiConn} disabled={testingConn} style={btnSecondary}>
                {testingConn ? "Testando..." : "↻ Testar conexão"}
              </button>
              <button onClick={saveUazapi} disabled={savingUazapi || !uazapiUrl} style={btnPrimary}>
                {savingUazapi ? "Salvando..." : "Salvar configurações Uazapi"}
              </button>
            </div>
          </div>
        </section>

        {/* Google Calendar */}
        <section style={sectionStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 style={{ ...h2Style, marginBottom: 0 }}>Google Calendar</h2>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
              background: gcalPrivateKeySet ? "var(--crm-success-soft)" : "var(--crm-surface-2)",
              color: gcalPrivateKeySet ? "var(--crm-success)" : "var(--crm-text-3)",
              border: `1px solid ${gcalPrivateKeySet ? "var(--crm-success)" : "var(--crm-border)"}`,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: gcalPrivateKeySet ? "var(--crm-success)" : "var(--crm-text-3)" }} />
              {gcalPrivateKeySet ? "Configurado" : "Não configurado"}
            </span>
          </div>

          <div style={{ fontSize: 12, color: "var(--crm-text-3)", marginBottom: 14, lineHeight: 1.6 }}>
            Quando configurado, ao agendar uma visita a Sofia verifica automaticamente a disponibilidade no calendário e cria o evento. Use uma <strong>Service Account</strong> com acesso ao calendário do Marcelo.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={labelStyle}>Calendar ID</label>
              <input type="text" value={gcalCalendarId}
                onChange={(e) => setGcalCalendarId(e.target.value)}
                placeholder="ex: marcelo@empresa.com ou abc123xyz@group.calendar.google.com"
                style={{ ...inputStyle, fontFamily: "JetBrains Mono, monospace" }} />
              <div style={{ fontSize: 11, color: "var(--crm-text-3)", marginTop: 4 }}>
                Calendário → Configurações → Integração do Google Agenda → ID do calendário
              </div>
            </div>

            <div>
              <label style={labelStyle}>Client Email (Service Account)</label>
              <input type="email" value={gcalClientEmail}
                onChange={(e) => setGcalClientEmail(e.target.value)}
                placeholder="nome@projeto.iam.gserviceaccount.com"
                style={{ ...inputStyle, fontFamily: "JetBrains Mono, monospace" }} />
            </div>

            <div>
              <label style={labelStyle}>
                Private Key (JSON)
                {gcalPrivateKeySet && !gcalPrivateKey && (
                  <span style={{ fontWeight: 400, color: "var(--crm-success)", marginLeft: 8 }}>✓ configurada</span>
                )}
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <textarea
                  value={gcalPrivateKey}
                  onChange={(e) => setGcalPrivateKey(e.target.value)}
                  rows={showGcalKey ? 8 : 2}
                  placeholder={gcalPrivateKeySet ? "Deixe em branco para manter a chave atual" : "Cole o conteúdo do campo private_key do JSON da service account\n(-----BEGIN RSA PRIVATE KEY----- ...)"}
                  style={{
                    ...inputStyle, flex: 1, fontFamily: "JetBrains Mono, monospace",
                    fontSize: 11, resize: "vertical",
                    filter: !showGcalKey ? "blur(3px)" : "none",
                  }}
                />
                <button type="button" onClick={() => setShowGcalKey((v) => !v)} style={{ ...btnSecondary, alignSelf: "flex-start" }}
                  title={showGcalKey ? "Ocultar" : "Mostrar"}>
                  {showGcalKey ? "🙈" : "👁️"}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "var(--crm-text-3)", marginTop: 4 }}>
                IAM → Service Accounts → Chaves → Adicionar chave JSON. Cole apenas o valor do campo <code>private_key</code>.
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
              <button onClick={saveGcal} disabled={savingGcal || !gcalCalendarId || !gcalClientEmail} style={btnPrimary}>
                {savingGcal ? "Salvando..." : "Salvar Google Calendar"}
              </button>
            </div>
          </div>
        </section>

        {/* Créditos Anthropic */}
        <section style={sectionStyle}>
          <h2 style={h2Style}>Créditos Anthropic</h2>
          {credits ? (
            credits.ok ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <div style={{ padding: 14, background: "var(--crm-surface-2)", borderRadius: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--crm-text-3)", textTransform: "uppercase", marginBottom: 6 }}>Saldo carregado</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{credits.baselineUsd != null ? `$${credits.baselineUsd.toFixed(2)}` : "—"}</div>
                    {credits.baselineAt && <div style={{ fontSize: 10, color: "var(--crm-text-4)", marginTop: 4 }}>Atualizado {new Date(credits.baselineAt).toLocaleDateString("pt-BR")}</div>}
                  </div>
                  <div style={{ padding: 14, background: "var(--crm-surface-2)", borderRadius: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--crm-text-3)", textTransform: "uppercase", marginBottom: 6 }}>Gasto desde baseline</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--crm-warning)" }}>${(credits.spentUsd ?? 0).toFixed(4)}</div>
                  </div>
                  <div style={{ padding: 14, background: credits.remainingUsd != null && credits.remainingUsd < 5 ? "var(--crm-danger-soft)" : "var(--crm-success-soft)", borderRadius: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--crm-text-3)", textTransform: "uppercase", marginBottom: 6 }}>Saldo estimado</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: credits.remainingUsd != null && credits.remainingUsd < 5 ? "var(--crm-danger)" : "var(--crm-success)" }}>
                      {credits.remainingUsd != null ? `$${credits.remainingUsd.toFixed(2)}` : "—"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--crm-text-2)" }}>Atualizar saldo carregado:</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>$</span>
                  <input
                    type="number" min={0} step={0.01}
                    value={baselineInput}
                    onChange={(e) => setBaselineInput(e.target.value)}
                    placeholder="ex: 50.00"
                    style={{ padding: "6px 8px", borderRadius: 5, border: "1px solid var(--crm-border)", background: "var(--crm-surface-2)", color: "var(--crm-text)", fontSize: 13, width: 120 }}
                  />
                  <button onClick={saveBaseline} disabled={savingBaseline || !baselineInput} style={btnSecondary}>
                    {savingBaseline ? "Salvando..." : "Salvar saldo"}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "var(--crm-text-3)" }}>
                  ⚠️ Anthropic billing tem delay de 24-48h. O gasto exibido pode estar atrasado em relação ao consumo real. Atualize o "saldo carregado" toda vez que comprar créditos novos.
                </div>
              </>
            ) : (
              <div style={{ padding: 12, color: "var(--crm-danger)", background: "var(--crm-danger-soft)", borderRadius: 6, fontSize: 13 }}>
                {credits.error ?? "Falha ao consultar admin API"}
              </div>
            )
          ) : (
            <div style={{ padding: 14, color: "var(--crm-text-3)", fontSize: 13 }}>Carregando...</div>
          )}
        </section>

        {/* Disparo automático */}
        <section style={sectionStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ ...h2Style, marginBottom: 0 }}>Disparo automático ao cadastrar</h2>
            <button
              onClick={() => saveDispatch({ enabled: !(dispatch?.enabled ?? false) })}
              disabled={!dispatch || savingDispatch}
              style={{
                padding: "8px 18px", borderRadius: 999, border: "none", cursor: "pointer",
                fontWeight: 700, fontSize: 12, color: "white",
                background: dispatch?.enabled ? "var(--crm-success)" : "var(--crm-text-4)",
                opacity: savingDispatch ? 0.6 : 1,
                minWidth: 120,
              }}
            >
              {savingDispatch ? "..." : dispatch?.enabled ? "● ATIVADO" : "○ DESATIVADO"}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--crm-text-3)", marginBottom: 14 }}>
            Quando <strong>ativado</strong>, novos leads cadastrados pelo formulário disparam automaticamente a primeira mensagem da Carol. Quando <strong>desativado</strong>, ninguém recebe nada (kill switch master).
          </div>

          {dispatch?.enabled && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                <button
                  onClick={() => saveDispatch({ mode: "all" })}
                  disabled={savingDispatch}
                  style={{
                    padding: "12px", borderRadius: 6,
                    border: dispatch.mode === "all" ? "2px solid var(--crm-accent)" : "1px solid var(--crm-border)",
                    background: dispatch.mode === "all" ? "var(--crm-accent-soft)" : "var(--crm-surface-2)",
                    color: "var(--crm-text)", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>🌍 Todos os números</div>
                  <div style={{ fontSize: 11, color: "var(--crm-text-3)", marginTop: 4 }}>
                    Qualquer lead novo recebe disparo automático
                  </div>
                </button>
                <button
                  onClick={() => saveDispatch({ mode: "whitelist" })}
                  disabled={savingDispatch}
                  style={{
                    padding: "12px", borderRadius: 6,
                    border: dispatch.mode === "whitelist" ? "2px solid var(--crm-accent)" : "1px solid var(--crm-border)",
                    background: dispatch.mode === "whitelist" ? "var(--crm-accent-soft)" : "var(--crm-surface-2)",
                    color: "var(--crm-text)", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>🧪 Apenas estes números</div>
                  <div style={{ fontSize: 11, color: "var(--crm-text-3)", marginTop: 4 }}>
                    Sandbox / teste — só os listados recebem
                  </div>
                </button>
              </div>

              {dispatch.mode === "whitelist" && (
                <div>
                  <label style={{ fontSize: 11, color: "var(--crm-text-3)", fontWeight: 600, textTransform: "uppercase" }}>
                    Números permitidos (1 por linha, qualquer formato — normalizado automaticamente)
                  </label>
                  <textarea
                    value={whitelistText}
                    onChange={(e) => setWhitelistText(e.target.value)}
                    rows={4}
                    placeholder="5592981951096&#10;(11) 99999-8888&#10;+55 11 91111-2222"
                    style={{
                      width: "100%", padding: 10, marginTop: 6,
                      fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                      color: "var(--crm-text)", background: "var(--crm-surface-2)",
                      border: "1px solid var(--crm-border)", borderRadius: 6, resize: "vertical",
                    }}
                  />
                  <button
                    onClick={() => saveDispatch({
                      whitelistPhones: whitelistText.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
                    })}
                    disabled={savingDispatch}
                    style={{ ...btnSecondary, marginTop: 8 }}
                  >
                    {savingDispatch ? "Salvando..." : "Salvar lista"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Etapas do Kanban */}
        <section style={sectionStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ ...h2Style, marginBottom: 0 }}>Etapas do Kanban</h2>
            <button
              onClick={() => setNewStage({ id: "", label: "", short: "", color: "#6366f1", owner: "human" })}
              style={btnSecondary}
              disabled={!!newStage}
            >+ Nova etapa</button>
          </div>

          {stageErr && (
            <div style={{ padding: 8, marginBottom: 10, background: "var(--crm-danger-soft)", color: "var(--crm-danger)", borderRadius: 6, fontSize: 12 }}>
              {stageErr}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {stages.map((s, idx) => (
              <div key={s.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 6,
                background: s.is_active ? "var(--crm-surface-2)" : "var(--crm-surface-3)",
                border: "1px solid var(--crm-border)",
                opacity: s.is_active ? 1 : 0.5,
              }}>
                {/* Cor */}
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, flexShrink: 0 }} />

                {editingStage?.id === s.id ? (
                  /* Modo edição inline */
                  <div style={{ flex: 1, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <input value={editingStage.label} onChange={(e) => setEditingStage({ ...editingStage, label: e.target.value })}
                      placeholder="Label" style={{ ...inputStyle, width: 140, padding: "4px 8px" }} />
                    <input value={editingStage.short} onChange={(e) => setEditingStage({ ...editingStage, short: e.target.value })}
                      placeholder="Short" style={{ ...inputStyle, width: 70, padding: "4px 8px" }} />
                    <input type="color" value={editingStage.color} onChange={(e) => setEditingStage({ ...editingStage, color: e.target.value })}
                      style={{ width: 36, height: 28, border: "1px solid var(--crm-border)", borderRadius: 4, cursor: "pointer", padding: 2 }} />
                    <select value={editingStage.owner} onChange={(e) => setEditingStage({ ...editingStage, owner: e.target.value as "ia" | "human" })}
                      style={{ ...inputStyle, width: 90, padding: "4px 8px" }}>
                      <option value="ia">IA</option>
                      <option value="human">Humano</option>
                    </select>
                    <button onClick={() => saveStage(editingStage)} disabled={savingStage} style={btnPrimary}>
                      {savingStage ? "..." : "Salvar"}
                    </button>
                    <button onClick={() => setEditingStage(null)} style={btnGhost}>Cancelar</button>
                  </div>
                ) : (
                  /* Modo visualização */
                  <>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{s.label}</span>
                    <span style={{ fontSize: 11, color: "var(--crm-text-3)", background: "var(--crm-surface-3)", padding: "1px 6px", borderRadius: 4 }}>
                      {s.owner === "ia" ? "IA" : "Humano"}
                    </span>
                    <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                      <button onClick={() => moveStage(s.id, -1)} disabled={idx === 0 || savingStage} style={{ ...btnGhost, padding: "2px 6px" }} title="Subir">↑</button>
                      <button onClick={() => moveStage(s.id, 1)} disabled={idx === stages.length - 1 || savingStage} style={{ ...btnGhost, padding: "2px 6px" }} title="Descer">↓</button>
                      <button onClick={() => setEditingStage({ ...s })} style={{ ...btnGhost, padding: "2px 8px" }}>Editar</button>
                      <button
                        onClick={() => setEditingPrompt({ ...s })}
                        style={{ ...btnGhost, padding: "2px 8px", color: s.ai_enabled !== false ? "var(--crm-accent)" : "var(--crm-text-4)" }}
                        title="Editar prompt e modelo da IA"
                      >🤖 IA</button>
                      <button
                        onClick={() => toggleStage(s)} disabled={savingStage}
                        style={{ ...btnGhost, padding: "2px 8px", color: s.is_active ? "var(--crm-danger)" : "var(--crm-success)" }}
                      >
                        {s.is_active ? "Desativar" : "Ativar"}
                      </button>
                      {!s.is_active && (
                        <button
                          onClick={() => deleteStage(s)} disabled={savingStage}
                          style={{ ...btnGhost, padding: "2px 8px", color: "var(--crm-danger)", opacity: 0.8 }}
                          title="Excluir permanentemente"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Formulário nova etapa */}
            {newStage && (
              <div style={{ padding: "10px", borderRadius: 6, border: "1px dashed var(--crm-accent)", background: "var(--crm-accent-soft)" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--crm-accent)", marginBottom: 8 }}>Nova etapa</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <input value={newStage.id} onChange={(e) => setNewStage({ ...newStage, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                    placeholder="id (ex: reuniao_realizada)" style={{ ...inputStyle, width: 180, padding: "4px 8px" }} />
                  <input value={newStage.label} onChange={(e) => setNewStage({ ...newStage, label: e.target.value })}
                    placeholder="Label" style={{ ...inputStyle, width: 140, padding: "4px 8px" }} />
                  <input value={newStage.short} onChange={(e) => setNewStage({ ...newStage, short: e.target.value })}
                    placeholder="Short" style={{ ...inputStyle, width: 70, padding: "4px 8px" }} />
                  <input type="color" value={newStage.color} onChange={(e) => setNewStage({ ...newStage, color: e.target.value })}
                    style={{ width: 36, height: 28, border: "1px solid var(--crm-border)", borderRadius: 4, cursor: "pointer", padding: 2 }} />
                  <select value={newStage.owner} onChange={(e) => setNewStage({ ...newStage, owner: e.target.value as "ia" | "human" })}
                    style={{ ...inputStyle, width: 90, padding: "4px 8px" }}>
                    <option value="ia">IA</option>
                    <option value="human">Humano</option>
                  </select>
                  <button onClick={createStage} disabled={savingStage || !newStage.id || !newStage.label || !newStage.short} style={btnPrimary}>
                    {savingStage ? "..." : "Criar"}
                  </button>
                  <button onClick={() => setNewStage(null)} style={btnGhost}>Cancelar</button>
                </div>
                <div style={{ fontSize: 11, color: "var(--crm-text-3)", marginTop: 6 }}>
                  ⚠️ Para que a nova etapa funcione no kanban, rode primeiro a migração SQL no Supabase.
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Modal: editar prompt + modelo da etapa */}
        {editingPrompt && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}>
            <div style={{
              background: "var(--crm-surface)", borderRadius: 10, padding: 24,
              width: "100%", maxWidth: 720, maxHeight: "90vh", overflowY: "auto",
              boxShadow: "var(--crm-shadow-xl)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
                  IA — {editingPrompt.label}
                </h3>
                <button onClick={() => setEditingPrompt(null)} style={{ ...btnGhost, fontSize: 16 }}>×</button>
              </div>

              {stageErr && (
                <div style={{ padding: 8, marginBottom: 12, background: "var(--crm-danger-soft)", color: "var(--crm-danger)", borderRadius: 6, fontSize: 12 }}>
                  {stageErr}
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Modelo da IA</label>
                <select
                  value={editingPrompt.ai_model ?? "claude-haiku-4-5"}
                  onChange={(e) => setEditingPrompt({ ...editingPrompt, ai_model: e.target.value })}
                  style={{ ...inputStyle, fontFamily: "JetBrains Mono, monospace" }}
                >
                  <option value="claude-haiku-4-5">claude-haiku-4-5 — rápido & barato</option>
                  <option value="claude-sonnet-4-6">claude-sonnet-4-6 — balanceado</option>
                  <option value="claude-opus-4-7">claude-opus-4-7 — mais inteligente</option>
                </select>
              </div>

              <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>IA ativa nesta etapa</label>
                <button
                  type="button"
                  onClick={() => setEditingPrompt({ ...editingPrompt, ai_enabled: !editingPrompt.ai_enabled })}
                  style={{
                    padding: "5px 14px", borderRadius: 999, border: "none", cursor: "pointer",
                    fontWeight: 700, fontSize: 12, color: "white",
                    background: editingPrompt.ai_enabled ? "var(--crm-success)" : "var(--crm-text-4)",
                  }}
                >
                  {editingPrompt.ai_enabled ? "● ATIVA" : "○ INATIVA"}
                </button>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <label style={labelStyle}>System prompt desta etapa</label>
                  <span style={{ fontSize: 11, color: "var(--crm-text-3)" }}>
                    Deixe em branco para usar o prompt padrão da etapa
                  </span>
                </div>
                <textarea
                  value={editingPrompt.system_prompt ?? ""}
                  onChange={(e) => setEditingPrompt({ ...editingPrompt, system_prompt: e.target.value || null })}
                  rows={18}
                  placeholder={`Prompt padrão será usado (${editingPrompt.id}).\n\nPlaceholders disponíveis:\n{{nome_para_mensagem}} · {{telefone_e164}} · {{localizacao_fl}}\n{{dor_confirmada}} · {{tipo_imovel}} · {{arquetipo_icp}}\n{{LEAD_CONTEXT}} · {{IA_NAME}} · {{BRAND_NAME}}`}
                  style={{
                    width: "100%", padding: 12, fontFamily: "JetBrains Mono, monospace",
                    fontSize: 11.5, lineHeight: 1.5, color: "var(--crm-text)",
                    background: "var(--crm-surface-2)", border: "1px solid var(--crm-border)",
                    borderRadius: 6, resize: "vertical", boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setEditingPrompt(null)} style={btnSecondary}>Cancelar</button>
                <button onClick={() => saveStagePrompt(editingPrompt)} disabled={savingStage} style={btnPrimary}>
                  {savingStage ? "Salvando..." : "Salvar configuração de IA"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modelo */}
        <section style={sectionStyle}>
          <h2 style={h2Style}>Modelo da IA</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(cfg?.allowedModels ?? []).map((m) => (
              <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 6, border: model === m.id ? "2px solid var(--crm-accent)" : "1px solid var(--crm-border)", background: model === m.id ? "var(--crm-accent-soft)" : "var(--crm-surface-2)", cursor: "pointer" }}>
                <input type="radio" checked={model === m.id} onChange={() => setModel(m.id)} />
                <code style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--crm-text)" }}>{m.id}</code>
                <span style={{ fontSize: 12, color: "var(--crm-text-3)" }}>— {m.label.split("—")[1]?.trim() ?? m.label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Temperature */}
        <section style={sectionStyle}>
          <h2 style={h2Style}>Temperatura ({temperature.toFixed(2)})</h2>
          <input type="range" min={0} max={1.5} step={0.05} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} style={{ width: "100%" }} />
          <div style={{ fontSize: 11, color: "var(--crm-text-3)", marginTop: 4 }}>
            0 = determinístico (mesma resposta sempre) · 1.0 = padrão equilibrado · 1.5 = criativo/imprevisível
          </div>
        </section>

        {/* Prompt */}
        <section style={sectionStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <h2 style={h2Style}>System prompt</h2>
            <button onClick={resetToDefault} style={btnGhost}>Restaurar padrão</button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={20}
            style={{
              width: "100%", padding: 12, fontFamily: "JetBrains Mono, monospace",
              fontSize: 12.5, lineHeight: 1.5, color: "var(--crm-text)",
              background: "var(--crm-surface-2)", border: "1px solid var(--crm-border)",
              borderRadius: 6, resize: "vertical",
            }}
          />
          <div style={{ fontSize: 11, color: "var(--crm-text-3)", marginTop: 6 }}>
            Placeholders disponíveis: <code>{"{{IA_NAME}}"}</code> (nome da persona, hoje "Carol") e <code>{"{{LEAD_CONTEXT}}"}</code> (dados do lead atual). Ambos interpolados em runtime.
          </div>
        </section>

        <div style={{ display: "flex", gap: 8, marginTop: 24, justifyContent: "flex-end" }}>
          <button onClick={load} disabled={saving} style={btnSecondary}>Descartar</button>
          <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? "Salvando..." : "Salvar configurações"}</button>
        </div>
      </main>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  background: "var(--crm-surface)", border: "1px solid var(--crm-border)",
  borderRadius: 8, padding: 18, marginBottom: 14,
};
const h2Style: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, textTransform: "uppercase",
  color: "var(--crm-text-3)", letterSpacing: "0.05em", marginTop: 0, marginBottom: 12,
};
const btnPrimary: React.CSSProperties = {
  padding: "10px 18px", background: "var(--crm-accent)", color: "white",
  border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "8px 14px", background: "var(--crm-surface-2)", color: "var(--crm-text)",
  border: "1px solid var(--crm-border)", borderRadius: 6, fontSize: 12, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "4px 10px", background: "transparent", color: "var(--crm-text-3)",
  border: "1px solid var(--crm-border)", borderRadius: 5, fontSize: 11, cursor: "pointer",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: "var(--crm-text-3)",
  textTransform: "uppercase", marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 6,
  border: "1px solid var(--crm-border)", background: "var(--crm-surface-2)",
  color: "var(--crm-text)", fontSize: 13,
  fontFamily: "JetBrains Mono, monospace",
  boxSizing: "border-box",
};
