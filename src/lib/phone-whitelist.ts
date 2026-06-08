import { getEnv } from "./env";
import { createServiceClient } from "./supabase";

/**
 * Canonicalizes any Brazilian phone to a single form: 55 + DDD + 9 + 8 digits (13 digits total).
 * Strips non-digits, prepends "55" if missing, and inserts the mobile "9" if absent.
 * Returns the best canonical — or the raw digits if shape doesn't match BR mobile.
 */
export function normalizeBrPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  // 13 digits starting with 55 + DDD + 9 + 8 → already canonical
  if (digits.length === 13 && digits.startsWith("55") && digits[4] === "9") return digits;
  // 12 digits starting with 55 (missing mobile 9): insert it
  if (digits.length === 12 && digits.startsWith("55")) return digits.slice(0, 4) + "9" + digits.slice(4);
  // 11 digits (no country code, with 9): prepend 55
  if (digits.length === 11 && digits[2] === "9") return "55" + digits;
  // 10 digits (no country code, no 9): prepend 55 and insert 9
  if (digits.length === 10) return "55" + digits.slice(0, 2) + "9" + digits.slice(2);
  return digits;
}

/**
 * Returns the whitelist of allowed phone digits.
 * For each entry, we also generate both variants (with and without the Brazilian "9" mobile prefix)
 * so that match works regardless of the format stored in DB or received from Uazapi.
 */
export function getAllowedPhoneVariants(): Set<string> | null {
  const raw = getEnv().CRM_ALLOWED_PHONES;
  if (!raw || raw.trim() === "") return null;

  const variants = new Set<string>();
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const digits = entry.replace(/\D/g, "");
    if (!digits) continue;
    variants.add(digits);

    // Toggle BR mobile "9" prefix
    if (digits.startsWith("55") && digits.length >= 12) {
      const countryDDD = digits.slice(0, 4);
      const rest = digits.slice(4);
      if (rest.length === 8) {
        variants.add(countryDDD + "9" + rest);
      } else if (rest.length === 9 && rest.startsWith("9")) {
        variants.add(countryDDD + rest.slice(1));
      }
    }
  }
  return variants;
}

/** Returns true if phone is allowed (or whitelist is empty/disabled). */
export function isPhoneAllowed(phone: string | null | undefined): boolean {
  const allowed = getAllowedPhoneVariants();
  if (!allowed) return true;
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");

  // Generate all plausible variants of the input (with/without country code, with/without 9)
  const candidates = new Set<string>();
  candidates.add(digits);

  // If it already starts with 55, try without
  if (digits.startsWith("55") && digits.length >= 12) {
    candidates.add(digits.slice(2));
    const rest = digits.slice(4);
    if (rest.length === 8) candidates.add(digits.slice(0, 4) + "9" + rest);
    else if (rest.length === 9 && rest.startsWith("9")) candidates.add(digits.slice(0, 4) + rest.slice(1));
  }

  // If it doesn't start with 55, prepend it
  if (!digits.startsWith("55")) {
    candidates.add("55" + digits);
    // BR mobile (11 digits: DDD + 9 + 8): also try without the 9
    if (digits.length === 11 && digits[2] === "9") {
      candidates.add("55" + digits.slice(0, 2) + digits.slice(3));
    }
    // BR mobile legacy (10 digits: DDD + 8): also try with the 9
    if (digits.length === 10) {
      candidates.add("55" + digits.slice(0, 2) + "9" + digits.slice(2));
    }
  }

  for (const c of candidates) {
    if (allowed.has(c)) return true;
    if (allowed.has("+" + c)) return true;
  }
  return false;
}

// =====================================================================
// Runtime dispatch config (read from crm_config table)
// =====================================================================

export type DispatchMode = "all" | "whitelist";

export type DispatchConfig = {
  enabled: boolean;
  mode: DispatchMode;
  whitelistPhones: string[]; // raw entries as user typed
};

/** Returns dispatch config from crm_config; defaults to OFF + whitelist with the test phone. */
export async function getDispatchConfig(): Promise<DispatchConfig> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("crm_config")
    .select("key, value")
    .in("key", ["dispatch_enabled", "dispatch_mode", "dispatch_whitelist_phones"]);

  const map = new Map((data ?? []).map((r) => [r.key, r.value]));
  return {
    enabled: (map.get("dispatch_enabled") ?? "false") === "true",
    mode: (map.get("dispatch_mode") as DispatchMode) || "whitelist",
    whitelistPhones: (map.get("dispatch_whitelist_phones") ?? "5592981951096")
      .split(/[,;\n]/)
      .map((s: string) => s.trim())
      .filter(Boolean),
  };
}

/**
 * Async variant: checks if a phone is allowed under the current dispatch config.
 *  - enabled=false → ALWAYS false (kill switch)
 *  - mode='all'    → ALWAYS true
 *  - mode='whitelist' → check phone in normalized list
 */
export async function isPhoneAllowedRuntime(phone: string | null | undefined): Promise<boolean> {
  const cfg = await getDispatchConfig();
  if (!cfg.enabled) return false;
  if (cfg.mode === "all") return true;
  if (!phone) return false;

  // Build canonical set of whitelisted phones (and BR variants)
  const allowed = new Set<string>();
  for (const entry of cfg.whitelistPhones) {
    const digits = entry.replace(/\D/g, "");
    if (!digits) continue;
    allowed.add(digits);
    allowed.add(normalizeBrPhone(digits));
  }

  const inputCanonical = normalizeBrPhone(phone);
  return allowed.has(phone.replace(/\D/g, "")) || allowed.has(inputCanonical);
}
