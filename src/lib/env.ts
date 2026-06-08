import { z } from "zod";

const envSchema = z.object({
  // Webhook
  WEBHOOK_SECRET: z.string().min(16),

  // Uazapi (WhatsApp) — optional here; can be set via crm_config table at runtime
  UAZAPI_URL: z.string().url().optional(),
  UAZAPI_TOKEN: z.string().min(1).optional(),
  UAZAPI_INSTANCE: z.string().optional(),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // AI Gateway (Vercel) — or direct Anthropic
  GATEWAY_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Google Gemini (for cheap sentiment analysis)
  GOOGLE_API_KEY: z.string().optional(),

  // Carol
  ACTIVE_CAROL_VERSION: z.enum(["v1"]).default("v1"),

  // Whitelist de números permitidos (testing). Vazio = sem filtro.
  CRM_ALLOWED_PHONES: z.string().optional(),

  // Telegram (closer notifications)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  CLOSER_TELEGRAM_CHAT_ID: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Env validation failed:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration — see logs");
  }
  cached = parsed.data;
  return cached;
}
