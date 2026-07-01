/**
 * WhatsApp provider abstraction.
 *
 * O salus-crm fala com múltiplas plataformas de WhatsApp (uazapi e Evolution API v2).
 * Cada plataforma tem endpoints, headers de auth e formatos de payload diferentes, mas
 * o CRM só precisa de 3 operações: enviar texto, mostrar "digitando" e checar status —
 * além de normalizar o webhook de entrada para um formato único.
 *
 * Estes tipos são o contrato comum. Os adapters (`uazapi.ts`, `evolution.ts`) implementam
 * `WhatsappAdapter`; o resto do código (steps de workflow, rotas de envio/status/webhook)
 * fica agnóstico de plataforma.
 */

export type WhatsappProvider = "uazapi" | "evolution";

/**
 * Config resolvida de uma instância (ou da config global uazapi, modo 1-número).
 * - `url`      base URL do servidor (uazapi: https://salus.uazapi.com | evolution: https://meu-evo.com)
 * - `token`    credencial: token da instância no uazapi OU apikey no Evolution
 * - `instance` uazapi: rótulo/instance (informativo) | evolution: instanceName (segmento de path, OBRIGATÓRIO)
 */
export type InstanceConfig = {
  provider: WhatsappProvider;
  url: string;
  token: string;
  instance: string;
};

/** Resultado normalizado de um envio de texto. */
export type SendResult = {
  ok: boolean;
  httpStatus: number;
  messageId: string | null;
  raw: unknown;
  /** Preenchido quando o erro é retryável (429/5xx) — dispara RetryableError no step. */
  retryAfter?: `${number}s`;
  /** Motivo curto para o message_log em caso de falha (ex: "rate_limited", "http_500"). */
  errorReason?: string;
};

/** Resultado normalizado do health-check de uma instância. */
export type StatusResult = {
  ok: boolean;
  /** connected | connecting | disconnected | unknown */
  status: string;
  name?: string | null;
  raw?: unknown;
  error?: string;
};

/**
 * Mensagem de entrada normalizada, independente da plataforma. É o que o processador
 * compartilhado (`process-inbound.ts`) consome para criar/atualizar lead, espelhar
 * outbound manual e retomar o workflow.
 */
export type NormalizedInbound = {
  /** id da mensagem na plataforma (idempotência). Pode ser "" se ausente. */
  messageId: string;
  /** dígitos do telefone do contato (sem "+", sem sufixo @s.whatsapp.net). */
  fromDigits: string;
  /** texto da mensagem. */
  text: string;
  /** true = mensagem enviada pelo número conectado (nós); false = o lead escreveu. */
  fromMe: boolean;
  /** true = enviada pela nossa própria API (já logada pelo step) — deve ser ignorada. */
  wasSentByApi: boolean;
  /** timestamp da mensagem em milissegundos. */
  timestampMs: number;
  /** id do chat na plataforma (para messages_received.chatid). */
  chatId: string;
  messageType: string;
  senderName?: string;
  /**
   * id da instância (whatsapp_instances.id = dígitos do número) que RECEBEU a mensagem.
   * null → cai no token global (modo 1-número). Multi-número/multi-provider usa isto para
   * responder pelo mesmo número.
   */
  receivingInstanceId: string | null;
  /** true = mensagem de grupo (deve ser ignorada). */
  isGroup: boolean;
  /** payload cru original (persistido em messages_received.raw_payload). */
  raw: unknown;
};

export interface WhatsappAdapter {
  /** Envia uma mensagem de texto. `phone` já vem normalizado (dígitos). */
  sendText(cfg: InstanceConfig, phone: string, text: string): Promise<SendResult>;
  /** Indicador "digitando…". Fire-and-forget — não deve lançar. */
  sendPresence(cfg: InstanceConfig, phone: string): Promise<void>;
  /** Health-check da instância/servidor. */
  getStatus(cfg: InstanceConfig): Promise<StatusResult>;
}
