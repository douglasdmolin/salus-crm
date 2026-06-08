/**
 * Explicações detalhadas de cada campo que aparece no CRM.
 * Estruturadas para um leigo (não-técnico) entender de onde vem cada dado.
 *
 * Usado pelo DebugGlossaryModal.
 */

export type DataKind = "direct" | "derived" | "joined" | "hardcoded" | "config";

export type FieldExplanation = {
  field: string;           // label legível
  kind: DataKind;
  origin: string;          // tabela.coluna OR "cálculo JS" OR "arquivo TS" etc
  sourceFile?: string;     // arquivo onde o cálculo / parse vive
  plainLanguage: string;   // explicação em português simples
  example: string;         // exemplo concreto
  reliability: "alta" | "média" | "baixa" | "débito";
  notes?: string;          // observações adicionais
};

export type ExplanationSection = {
  title: string;
  intro: string;
  fields: FieldExplanation[];
};

export const KIND_META: Record<DataKind, { emoji: string; label: string; color: string; description: string }> = {
  direct: {
    emoji: "📊",
    label: "Direto do banco",
    color: "var(--crm-success)",
    description:
      "Valor exato de uma coluna da tabela no Supabase. Foi digitado/capturado em algum momento (formulário, integração) e ficou guardado lá. É o tipo mais confiável: se tá no card, tá na tabela.",
  },
  derived: {
    emoji: "🔄",
    label: "Calculado na hora",
    color: "var(--crm-accent)",
    description:
      "O CRM não armazena esse valor na tabela. Ele calcula toda vez que você abre o card, usando outros dados + regras em JavaScript. Vantagem: sempre atualizado. Desvantagem: depende das regras estarem corretas.",
  },
  joined: {
    emoji: "🔗",
    label: "Vindo de outra tabela",
    color: "var(--crm-stage-call)",
    description:
      "Não é da tabela principal (applications), mas sim de uma tabela relacionada. Ex: histórico de mensagens vem de messages_received + message_log. O CRM faz uma consulta cruzada.",
  },
  hardcoded: {
    emoji: "⚠️",
    label: "Fixo no código (débito técnico)",
    color: "var(--crm-danger)",
    description:
      "Valor fixo no código-fonte, não vem de lugar nenhum do banco. Indica que ou o schema ainda não tem essa coluna, ou alguém esqueceu de conectar. É um DÉBITO TÉCNICO — precisa virar variável real antes de produção séria.",
  },
  config: {
    emoji: "⚙️",
    label: "Configuração em arquivo",
    color: "var(--crm-warning)",
    description:
      "Valor em um arquivo TypeScript do projeto (ex: nome da IA, lista de membros do time). Pra mudar, precisa editar o código e fazer novo deploy. Não é editável em produção.",
  },
};

export const SECTIONS: ExplanationSection[] = [
  {
    title: "Identidade do lead",
    intro: "Quem é a pessoa — nome, contato, onde trabalha. Geralmente vem direto do formulário de inscrição.",
    fields: [
      {
        field: "Nome",
        kind: "direct",
        origin: "applications.full_name",
        plainLanguage:
          "O nome completo que a pessoa digitou no formulário de inscrição para a {{BRAND_NAME}}.",
        example: "'José Carlos Amorim' → campo 'full_name' da tabela applications",
        reliability: "alta",
      },
      {
        field: "WhatsApp / Telefone",
        kind: "direct",
        origin: "applications.phone",
        plainLanguage:
          "Número de celular em formato brasileiro (pode vir com ou sem o '9' depois do DDD). É a chave usada para casar mensagens recebidas do Uazapi com o lead correto.",
        example: "'5592981951096' ou '(92) 98195-1096'",
        reliability: "alta",
      },
      {
        field: "Email",
        kind: "direct",
        origin: "applications.email",
        plainLanguage: "Email opcional do formulário de inscrição.",
        example: "'rafael@empresa.com'",
        reliability: "média",
        notes: "Nem todo lead preenche.",
      },
      {
        field: "Cargo",
        kind: "direct",
        origin: "applications.role",
        sourceFile: "captado pela IA via tool 'anotar_cargo' (src/workflows/steps/carol-turn.ts)",
        plainLanguage:
          "A IA ouve a conversa e, quando o lead revela o cargo ('sou CEO', 'gerente comercial', 'fundador'), chama automaticamente a tool 'anotar_cargo' que grava em applications.role. Começa vazio — só preenche depois que o lead disser.",
        example: "Lead diz 'sou fundador da Acme' → tool anotar_cargo('Fundador') → applications.role = 'Fundador'",
        reliability: "média",
        notes: "Pra leads antigos (pré-migration), ainda lê do campo notes como fallback.",
      },
      {
        field: "Empresa",
        kind: "direct",
        origin: "applications.company",
        sourceFile: "captado pela IA via tool 'anotar_empresa' (src/workflows/steps/carol-turn.ts)",
        plainLanguage:
          "Mesma lógica do Cargo: a IA detecta o nome da empresa na conversa e grava via tool 'anotar_empresa'. Começa vazio até o lead citar.",
        example: "Lead diz 'trabalho na TechAmazonas' → tool anotar_empresa('TechAmazonas') → applications.company = 'TechAmazonas'",
        reliability: "média",
      },
      {
        field: "Origem",
        kind: "config",
        origin: "próxima versão — todas marcadas como 'formulário'",
        plainLanguage:
          "Por ora, assume que todos os leads chegam pelo formulário. Versão futura terá coluna applications.source com valores como 'formulário', 'indicação', 'instagram_ads', etc.",
        example: "Todo lead → 'formulário' (por enquanto fixo)",
        reliability: "débito",
        notes: "**Futura melhoria**: `alter table applications add column source text`. Populado pelo front do formulário ou integração (Meta Ads, Google Ads).",
      },
    ],
  },
  {
    title: "Inteligência da IA sobre o lead",
    intro:
      "Esses campos representam a 'avaliação automática' que o sistema faz do lead. Alguns vêm do pipeline OSINT antigo (enriquecimento externo), outros são calculados na hora baseado no estágio e no comportamento.",
    fields: [
      {
        field: "Score IA (0–100)",
        kind: "derived",
        origin: "applications.enrichment_score OU regra de fallback",
        sourceFile: "src/components/crm/ui-lead.ts → deriveScore()",
        plainLanguage:
          "Quando o pipeline OSINT já rodou, usa o score de lá. Quando não rodou (lead criado manual ou via formulário novo), calcula um score aproximado baseado em qual coluna do kanban o lead está: 'Novo' = 45%, 'Em contato' = 60-72%, 'Call agendada' = 85%, etc.",
        example: "enrichment_score=null, crm_stage='em_contato', reply_count=2 → 72%",
        reliability: "baixa",
        notes:
          "Quando o score é derivado, é mais uma ESTIMATIVA para dar sinal visual. Não confunda com score OSINT real (que tem confiança matemática).",
      },
      {
        field: "Sentimento (positivo/neutro/negativo)",
        kind: "direct",
        origin: "applications.ai_sentiment",
        sourceFile: "src/workflows/steps/sentiment.ts (Gemini 2.5 Flash Lite)",
        plainLanguage:
          "Após cada mensagem que o lead envia, o workflow chama o Google Gemini Flash Lite (modelo barato e rápido) para classificar o sentimento como positivo, neutro ou negativo. O resultado é gravado em applications.ai_sentiment e usado pela UI.",
        example: "Lead diz 'Show! Quero fechar ainda esse mês' → Gemini responde 'positive' → ai_sentiment = 'positive'",
        reliability: "alta",
        notes:
          "Requer env var GOOGLE_API_KEY. Sem ela, cai em fallback regex (confiabilidade baixa). Chave gratuita em https://aistudio.google.com/apikey — free tier generoso pra esse volume.",
      },
      {
        field: "Próxima ação sugerida",
        kind: "derived",
        origin: "estágio + reply_count + última msg do lead",
        sourceFile: "src/components/crm/ui-lead.ts → deriveNextAction()",
        plainLanguage:
          "Sugere o que fazer agora baseado em 3 coisas: em qual coluna o lead está, quantas vezes ele já respondeu, e o tom da última resposta dele.",
        example:
          "Estágio 'Em contato' + reply_count=3 → 'Aprofundar qualificação'. Estágio 'Call agendada' → 'Call daqui 2h'.",
        reliability: "média",
      },
      {
        field: "Resumo",
        kind: "derived",
        origin: "qualification_notes OU notes OU template",
        sourceFile: "src/components/crm/ui-lead.ts → applicationToUiLead()",
        plainLanguage:
          "Prioridade 1: se o campo qualification_notes existe (geralmente preenchido depois da IA decidir algo), usa ele. Prioridade 2: usa o notes. Prioridade 3: monta um template com cargo + empresa + stage.",
        example:
          "Com qualification_notes: 'Lead quente — faturamento 500k, interessado em plano anual'. Sem: 'Lead em contato_respondido_pela_ia — CEO @ Teste'",
        reliability: "média",
      },
      {
        field: "Responsável",
        kind: "derived",
        origin: "derivado do crm_stage",
        sourceFile: "src/components/crm/ui-lead.ts → deriveAssignee()",
        plainLanguage:
          "Se o lead está em uma coluna gerida pela IA (Novo, Respondido IA, Em contato, Descartado, Contato futuro), o responsável é 'Assistente IA'. Se está em coluna humana (Ligação, Call, Negociação, Ganho, Perdido), é 'Você'.",
        example: "crm_stage='call_agendada' → Responsável: 'Você'",
        reliability: "alta",
        notes:
          "Por ora só tem dois tipos: 'ai' e 'closer'. Em versões futuras com múltiplos humanos, vai precisar de coluna `assigned_to_user_id`.",
      },
      {
        field: "Tags",
        kind: "config",
        origin: "próxima versão",
        plainLanguage:
          "Sistema de tags virá em breve. Vai permitir o operador marcar leads com etiquetas customizadas (ex: 'quente', 'indicação', 'precisa follow-up').",
        example: "(sem dados por ora)",
        reliability: "débito",
        notes:
          "**Futura implementação**: tabela `lead_tags(application_id, tag_name, created_at, created_by)` com RLS por squad.",
      },
    ],
  },
  {
    title: "Controle e automação",
    intro:
      "Flags e IDs que controlam o comportamento do workflow da IA. Importante: são operacionais, mudam durante a vida do lead.",
    fields: [
      {
        field: "Estágio CRM (coluna do kanban)",
        kind: "direct",
        origin: "applications.crm_stage",
        plainLanguage:
          "É a coluna atual no kanban. Enum com 10 valores fixos: novo, contato_respondido_pela_ia, em_contato, ligacao_agendada, call_agendada, em_negociacao, ganho, perdido, descartado, contato_futuro. Muda quando a IA qualifica, quando o closer arrasta, ou quando o workflow decide.",
        example: "'contato_respondido_pela_ia' = card está na coluna 'Respondido pela IA'",
        reliability: "alta",
      },
      {
        field: "IA pausada",
        kind: "direct",
        origin: "applications.ai_paused",
        plainLanguage:
          "Quando true, a IA para de responder esse lead até o botão 'Retomar IA' ser clicado. Automaticamente vira true quando você envia mensagem pelo CRM ou pelo celular direto.",
        example: "ai_paused=true → IA silenciada; humano no controle",
        reliability: "alta",
      },
      {
        field: "Workflow Run ID",
        kind: "direct",
        origin: "applications.workflow_run_id",
        plainLanguage:
          "ID do workflow durável no Vercel Workflow DevKit que está cuidando da conversa desse lead. Serve pra debug (ver logs, cancelar, inspecionar).",
        example: "'wrun_01KPH0M2TAFHRSWS27TH2FVB9M' (formato ULID)",
        reliability: "alta",
      },
      {
        field: "Não contatar (DNC)",
        kind: "direct",
        origin: "applications.do_not_contact",
        plainLanguage:
          "Flag LGPD. Quando true, o sistema se recusa a enviar qualquer mensagem. Respeitado tanto pelo workflow quanto pelo endpoint de envio manual.",
        example: "do_not_contact=true → qualquer tentativa de enviar retorna erro",
        reliability: "alta",
      },
      {
        field: "Contador de respostas do lead",
        kind: "direct",
        origin: "applications.reply_count",
        plainLanguage:
          "Quantas vezes o lead respondeu no total. Usado como 'unread' no badge azul do card e como input na derivação de score e próxima ação.",
        example: "reply_count=3 → aparece '3' no badge do card",
        reliability: "alta",
      },
    ],
  },
  {
    title: "Mensagens e conversa",
    intro:
      "A timeline do chat vem de DUAS tabelas diferentes, que o CRM junta (JOIN) pra mostrar a conversa em ordem cronológica.",
    fields: [
      {
        field: "Mensagens recebidas (lead → você)",
        kind: "joined",
        origin: "messages_received (tabela inteira)",
        plainLanguage:
          "Toda mensagem que o lead manda pelo WhatsApp é gravada nessa tabela quando o Uazapi chama nosso webhook. Cada row tem lead_id (FK), texto, timestamp, e o ID único do Uazapi (pra evitar processar a mesma mensagem duas vezes).",
        example:
          "Lead manda 'oi'. Uazapi → nosso /api/uazapi/webhook → INSERT em messages_received.",
        reliability: "alta",
      },
      {
        field: "Mensagens enviadas (você/IA → lead)",
        kind: "joined",
        origin: "message_log (tabela inteira)",
        plainLanguage:
          "Toda mensagem que SAI (IA ou humano) é gravada aqui. O campo 'error_reason' distingue: null/vazio = IA, 'human_sent_crm' = humano via CRM, 'human_sent_phone' = humano via WhatsApp direto do celular.",
        example:
          "Carol envia 'Oi Teste, aqui é a Carol...'. INSERT em message_log com status='sent' e error_reason=null.",
        reliability: "alta",
      },
      {
        field: "Preview da última mensagem (no card)",
        kind: "joined",
        origin: "max(messages_received, message_log) por timestamp",
        sourceFile: "src/components/crm/KanbanBoard.tsx → fetchAll()",
        plainLanguage:
          "O card mostra só a mensagem mais recente de qualquer direção. O CRM busca as duas tabelas, pega a mais nova, exibe como preview com ícone verde do WhatsApp.",
        example:
          "Última msg: IA mandou '...' às 15:25, depois lead respondeu 'oi tudo bem' às 15:26 → preview mostra 'oi tudo bem'",
        reliability: "alta",
      },
      {
        field: "Autor da mensagem (IA / Operador / Lead)",
        kind: "joined",
        origin: "message_log.error_reason + direction",
        sourceFile: "src/app/api/leads/[id]/messages/route.ts",
        plainLanguage:
          "O endpoint /api/leads/:id/messages decide o 'autor' assim: se a mensagem vem de messages_received, autor='lead'. Se vem de message_log com error_reason='human_sent_*', autor='human'. Senão, autor='ai'.",
        example: "message_log row com error_reason='human_sent_crm' → autor='human' → label 'Operador'",
        reliability: "alta",
      },
      {
        field: "Tempo na coluna (ex: 'há 23min')",
        kind: "derived",
        origin: "applications.updated_at",
        sourceFile: "src/components/crm/ui-lead.ts → formatTime()",
        plainLanguage:
          "Diferença entre agora e o momento em que o card foi atualizado pela última vez. Formatado em português: 'agora', '5min', '2h', 'ontem', '3d'.",
        example: "updated_at = agora - 23 min → 'há 23min'",
        reliability: "alta",
      },
    ],
  },
  {
    title: "Configuração em arquivo",
    intro:
      "Valores que ficam em arquivos TypeScript do projeto, não no banco. Pra mudar precisa editar código e fazer deploy novo.",
    fields: [
      {
        field: "Nome da persona da IA (ex: 'Carol')",
        kind: "config",
        origin: "constante IA_PERSONA_NAME",
        sourceFile: "src/workflows/prompts/carol-v1.ts (linha 5)",
        plainLanguage:
          "Como a IA se apresenta no WhatsApp: 'aqui é a Carol da Sociedade...'. Trocar a variável dispara mudança em todos os novos workflows. Workflows antigos mantêm o nome de quando foram criados (por causa do replay determinístico do Workflow DevKit).",
        example: "const IA_PERSONA_NAME = 'Carol'",
        reliability: "alta",
      },
      {
        field: "Lista de membros do 'time'",
        kind: "config",
        origin: "constante TEAM",
        sourceFile: "src/components/crm/ui-lead.ts (linha 198)",
        plainLanguage:
          "Array fixo com 2 entradas: 'Assistente IA' (id=ai, roxo) e 'Você' (id=closer, azul). Usado pra renderizar avatares e labels. Expansão futura com humanos reais requer coluna `applications.assigned_to_user_id` e uma tabela de users.",
        example: "TEAM[0] = { id: 'ai', name: 'Assistente IA', color: '#8b5cf6' }",
        reliability: "alta",
      },
      {
        field: "Whitelist de números (sandbox)",
        kind: "config",
        origin: "env var CRM_ALLOWED_PHONES",
        sourceFile: ".env.local / Vercel env vars",
        plainLanguage:
          "Lista separada por vírgula dos números que o sistema pode processar. Fora dela, tanto mensagens entrando quanto saindo são bloqueadas. Pra produção, deixar vazio = libera todos.",
        example: "CRM_ALLOWED_PHONES=5592981951096",
        reliability: "alta",
        notes: "Pra desativar: definir a variável como vazia ('').",
      },
    ],
  },
];
