import { generateText, tool, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { sendWhatsapp } from "./uazapi";
import { carolSystemPrompt } from "../prompts/ai-persona";
import { createServiceClient, type Application } from "../../lib/supabase";
import { getCarolConfig } from "../../lib/crm-config";

/**
 * Carol LLM turn — runs inside ONE WDK step using direct Anthropic provider.
 * Tracks whether any message was actually sent to avoid double-send fallbacks
 * (result.toolCalls from ai-sdk only reflects the last step, not the full stream).
 */
export async function carolTurn(
  leadId: string,
  lead: Application,
  history: ModelMessage[]
): Promise<{ text: string; messagesSent: number }> {
  "use step";
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const cfg = await getCarolConfig();

  console.log("carolTurn: invoking", { leadId, historyLen: history.length, model: cfg.model });

  let messagesSent = 0;

  const result = await generateText({
    model: anthropic(cfg.model),
    temperature: cfg.temperature,
    system: carolSystemPrompt(lead, cfg.prompt),
    messages: history,
    tools: {
      responder: tool({
        description:
          "Envia uma mensagem WhatsApp para o lead. SEMPRE use esta tool para responder. É a ÚNICA forma da sua resposta chegar ao lead.",
        inputSchema: z.object({
          texto: z.string().describe("Texto da mensagem a ser enviada"),
        }),
        execute: async ({ texto }: { texto: string }) => {
          const supabase = createServiceClient();
          const { data: fresh } = await supabase
            .from("applications")
            .select("ai_paused")
            .eq("id", leadId)
            .maybeSingle();
          if (fresh?.ai_paused) {
            console.log("carolTurn: aborted send — ai_paused became true mid-turn", { leadId });
            return { ok: false, reason: "ai_paused" };
          }
          await sendWhatsapp(leadId, texto);
          messagesSent += 1;
          return { ok: true };
        },
      }),
      anotar_cargo: tool({
        description:
          "Registra o cargo/função do lead quando ele revela na conversa. Use SEMPRE que o lead disser o cargo, mesmo informalmente (ex: 'sou CEO', 'gerente comercial', 'fundador', 'sócio', 'trabalho como X').",
        inputSchema: z.object({
          cargo: z.string().describe("O cargo/função que o lead mencionou. Padronize em formato título ex: 'CEO', 'Gerente de Marketing', 'Sócio-fundador'."),
        }),
        execute: async ({ cargo }: { cargo: string }) => {
          const supabase = createServiceClient();
          await supabase.from("applications").update({ role: cargo }).eq("id", leadId);
          console.log("carolTurn: anotar_cargo", { leadId, cargo });
          return { ok: true };
        },
      }),
      anotar_empresa: tool({
        description:
          "Registra o nome da empresa/operação que o lead mencionou. Use SEMPRE que o lead citar a empresa (ex: 'minha empresa X', 'a Acme Corp', 'trabalho na Y').",
        inputSchema: z.object({
          empresa: z.string().describe("Nome da empresa ou operação. Use como dito pelo lead."),
        }),
        execute: async ({ empresa }: { empresa: string }) => {
          const supabase = createServiceClient();
          await supabase.from("applications").update({ company: empresa }).eq("id", leadId);
          console.log("carolTurn: anotar_empresa", { leadId, empresa });
          return { ok: true };
        },
      }),
      descartar_lead: tool({
        description:
          "Marca o lead como DESCARTADO quando ele não tem perfil para o produto/serviço. Use APENAS quando: (1) o lead disser explicitamente que não tem interesse, (2) o perfil estiver claramente fora dos critérios definidos no system prompt, ou (3) conversa persistentemente hostil. Após descartar, a IA para de responder esse lead automaticamente.",
        inputSchema: z.object({
          motivo: z.string().describe("Motivo curto e específico do descarte em 1 frase. Ex: 'Sem operação rodando — está em fase de construção da empresa', 'Não demonstrou interesse após 2 abordagens', 'Profissional liberal sem operação empresarial'."),
        }),
        execute: async ({ motivo }: { motivo: string }) => {
          const supabase = createServiceClient();
          await supabase
            .from("applications")
            .update({
              crm_stage: "descartado",
              descarte_motivo: motivo,
              ai_paused: true,
              ai_paused_at: new Date().toISOString(),
            })
            .eq("id", leadId);
          console.log("carolTurn: descartar_lead", { leadId, motivo });
          return { ok: true };
        },
      }),
    },
    stopWhen: stepCountIs(4),
  });

  const text = result.text ?? "";

  console.log("carolTurn: done", {
    leadId,
    text: text.slice(0, 120),
    messagesSent,
    finishReason: result.finishReason,
  });

  // If the tool was called at least once, we're good — no fallback needed.
  if (messagesSent > 0) {
    return { text, messagesSent };
  }

  // Tool was NOT called. Try to salvage the turn — but re-check ai_paused first.
  if (text.trim().length > 0) {
    const supabase = createServiceClient();
    const { data: fresh } = await supabase
      .from("applications")
      .select("ai_paused")
      .eq("id", leadId)
      .maybeSingle();
    if (fresh?.ai_paused) {
      console.log("carolTurn: fallback aborted — ai_paused", { leadId });
      return { text, messagesSent };
    }
    console.log("carolTurn: fallback — sending generated text directly", { leadId });
    await sendWhatsapp(leadId, text.trim());
    messagesSent += 1;
  } else {
    console.warn("carolTurn: stall (no tool + no text) — silent", { leadId });
    // Do not send a "let me check and get back" message — it confuses the user
    // if the next real reply comes in quickly. Better to stay silent and wait.
  }

  return { text, messagesSent };
}
