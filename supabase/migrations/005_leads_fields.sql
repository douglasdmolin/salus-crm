-- ============================================================
-- Migration 005: Campos do schema Salus leads
-- Adiciona colunas presentes no schema externo (leads)
-- que faltam na tabela applications.
-- ============================================================

-- Identificador único da origem (ex: DEMO-001, SAL-00097)
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS id_unico TEXT UNIQUE;

-- Nome formatado para uso direto nos prompts da IA
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS nome_para_mensagem TEXT;

-- Mensagem exata do 1º disparo (NÃO passa pela IA — envia diretamente)
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS mensagem_sugerida TEXT;

-- Histórico e contexto completo do lead (alimenta o system prompt)
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS contexto TEXT;

-- Texto de abertura contextualizado pelo nível de awareness
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS abertura_awareness TEXT;

-- Ciclo de nutrição atual (D+3, D+7, D+14, D+28)
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ciclo_nutricao TEXT;

-- Score de priorização (0–100)
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS score_prioridade INTEGER DEFAULT 0;

-- Tier de prioridade (1 = máxima)
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 2;

-- Região / bairro na Flórida
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS zip_bairro TEXT;

-- ============================================================
-- Populando nome_para_mensagem a partir de full_name
-- para leads já existentes sem esse campo preenchido
-- ============================================================
UPDATE public.applications
SET nome_para_mensagem = split_part(full_name, ' ', 1)
WHERE nome_para_mensagem IS NULL
  AND full_name IS NOT NULL;

-- ============================================================
-- Atualizar os 3 leads de demo com os dados corretos
-- do schema externo (telefone E.164 + mensagem_sugerida)
-- ============================================================

-- Cristiane
UPDATE public.applications
SET
  id_unico            = 'DEMO-001',
  nome_para_mensagem  = 'Cristiane',
  mensagem_sugerida   = 'Oi Cristiane, aqui é da Salus Water. Você considerou nosso sistema com a gente um tempo atrás — posso passar aí pra avaliar a água da sua casa SEM compromisso. Quando fica bom?',
  contexto            = 'Lead com 2 interações anteriores com a Salus — alta intenção comprovada. Mora em Doral com família. Filhos pequenos. Preocupada com qualidade da água para as crianças.',
  abertura_awareness  = 'Você considerou nosso sistema com a gente um tempo atrás — posso passar aí pra avaliar a água da sua casa.',
  zip_bairro          = 'Doral / Miami-Dade',
  score_prioridade    = 100,
  tier                = 1
WHERE full_name ILIKE '%cristiane%'
  AND deleted_at IS NULL;

-- Sttan
UPDATE public.applications
SET
  id_unico            = 'DEMO-002',
  nome_para_mensagem  = 'Sttan',
  mensagem_sugerida   = 'Oi Sttan, aqui é da Salus Water. Você considerou nosso sistema com a gente um tempo atrás — posso passar aí pra avaliar a água da sua casa SEM compromisso. Quando fica bom?',
  contexto            = 'Lead com 2 interações anteriores com a Salus — alta intenção comprovada. Mora em Lake Nona / Orlando. Casa própria. Preocupado com manchas na máquina de lavar e gosto da água.',
  abertura_awareness  = 'Você considerou nosso sistema com a gente um tempo atrás — posso passar aí pra avaliar a água da sua casa.',
  zip_bairro          = 'Orlando / Lake Nona',
  score_prioridade    = 78,
  tier                = 1
WHERE full_name ILIKE '%sttan%'
  AND deleted_at IS NULL;

-- Douglas
UPDATE public.applications
SET
  id_unico            = 'DEMO-003',
  nome_para_mensagem  = 'Douglas',
  mensagem_sugerida   = 'Oi Douglas, te conhecemos no Expo Brasil em Orlando. Posso fazer um check-up rápido da qualidade da água da sua casa, sem compromisso? Tem 5 min essa semana?',
  contexto            = 'Lead conhecido no Expo Brasil em Orlando — presença física confirmada. Mora em Miami Beach. Casa própria. Interessado em purificação após ver demonstração no evento.',
  abertura_awareness  = 'Te conhecemos no Expo Brasil em Orlando. Posso fazer um check-up rápido da qualidade da água da sua casa.',
  zip_bairro          = 'Fort Lauderdale',
  score_prioridade    = 70,
  tier                = 1
WHERE full_name ILIKE '%douglas%'
  AND deleted_at IS NULL;

-- ============================================================
-- Garantir que stage 'novo' tem IA habilitada
-- ============================================================
UPDATE public.kanban_stages
SET ai_enabled = true
WHERE id = 'novo';

-- ============================================================
-- Verificação
-- ============================================================
-- SELECT id_unico, full_name, nome_para_mensagem, phone,
--        mensagem_sugerida, crm_stage, score_prioridade
-- FROM public.applications
-- WHERE id_unico LIKE 'DEMO-%'
-- ORDER BY score_prioridade DESC;
