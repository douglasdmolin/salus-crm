import { createServiceClient } from "./supabase";
import { DEFAULT_AI_PROMPT_TEMPLATE } from "../config/project";

export type UazapiConfig = { url: string; token: string; instance: string };

/**
 * Reads the uazapi connection config. The base URL é compartilhada entre todas as
 * instâncias; o TOKEN é o que muda por número de WhatsApp.
 *
 * - Sem `instanceId`: usa o token global (crm_config.uazapi_token / env) — modo 1-número.
 * - Com `instanceId`: usa o token da instância correspondente em `whatsapp_instances`
 *   (multi-número). Faz fallback para o global se a instância não existir/estiver inativa.
 */
export async function getUazapiConfig(instanceId?: string | null): Promise<UazapiConfig | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("crm_config")
    .select("key, value")
    .in("key", ["uazapi_url", "uazapi_token", "uazapi_instance"]);

  const map = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));
  let url        = map.get("uazapi_url")      || process.env.UAZAPI_URL;
  let token      = map.get("uazapi_token")    || process.env.UAZAPI_TOKEN;
  let instance   = map.get("uazapi_instance") || process.env.UAZAPI_INSTANCE || "";

  if (instanceId) {
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("uazapi_token, uazapi_url, name, active")
      .eq("id", instanceId)
      .maybeSingle();
    if (inst?.active && inst.uazapi_token) {
      token = inst.uazapi_token as string;
      instance = (inst.name as string) || instance;
      // Cada instância pode estar em um servidor uazapi diferente.
      if (inst.uazapi_url) url = inst.uazapi_url as string;
    }
  }

  if (!url || !token) return null;
  return { url, token, instance };
}

/** IDs das instâncias de WhatsApp ativas, em ordem — usado no round-robin do disparo. */
export async function listActiveInstanceIds(): Promise<string[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("active", true)
    .order("id", { ascending: true });
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Centralized read/write of CRM runtime config from `crm_config` table (key/value).
 *
 * - `carol_prompt`  — full system prompt template for the AI persona. Edited by operator
 *                     in /crm/config without redeploy. Falls back to hardcoded default if absent.
 * - `carol_model`   — Anthropic model id used by carolTurn step. e.g. "claude-haiku-4-5".
 * - `carol_temperature` — float, model temperature (optional)
 *
 * Reads happen inside step functions, so the operator can change config and the next step
 * uses the new value. Already-executed steps remain immutable per Workflow DevKit replay rules.
 */

export type CarolConfig = {
  prompt: string;
  model: string;
  temperature: number;
};

export const DEFAULT_CAROL_MODEL = "claude-haiku-4-5";
export const DEFAULT_CAROL_TEMPERATURE = 1.0;

export const ALLOWED_MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5 — rápido & barato (recomendado)" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 — balanceado" },
  { id: "claude-opus-4-7", label: "Opus 4.7 — mais inteligente, mais caro" },
] as const;

const DEFAULT_PROMPT_TEMPLATE = DEFAULT_AI_PROMPT_TEMPLATE;

/** Reads carol_prompt + carol_model from crm_config, with hardcoded fallbacks. */
export async function getCarolConfig(): Promise<CarolConfig> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("crm_config")
    .select("key, value")
    .in("key", ["carol_prompt", "carol_model", "carol_temperature"]);

  const map = new Map((data ?? []).map((r) => [r.key, r.value]));
  const tempStr = map.get("carol_temperature");
  return {
    prompt: map.get("carol_prompt") || DEFAULT_PROMPT_TEMPLATE,
    model: map.get("carol_model") || DEFAULT_CAROL_MODEL,
    temperature: tempStr ? Number(tempStr) : DEFAULT_CAROL_TEMPERATURE,
  };
}

export const CAROL_DEFAULT_PROMPT = DEFAULT_PROMPT_TEMPLATE;

/** Retorna true se os 3 campos de Google Calendar estão configurados no crm_config. */
export async function isGoogleCalendarConfigured(): Promise<boolean> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("crm_config")
    .select("key")
    .in("key", ["gcal_calendar_id", "gcal_client_email", "gcal_private_key"]);
  return (data ?? []).length === 3;
}

/** Número de WhatsApp para notificações do coordenador (ex: agendamentos, leads quentes). */
export async function getNotificationPhone(): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("crm_config")
    .select("value")
    .eq("key", "notification_phone")
    .maybeSingle();
  return (data?.value as string | null) ?? process.env.NOTIFICATION_PHONE ?? null;
}
