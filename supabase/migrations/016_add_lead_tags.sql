-- Adiciona coluna lead_tags para tagging em tempo real durante conversas.
-- Cada tag é um objeto: { tag: string, categoria: string, valor?: string, set_at: ISO }
-- ICPs podem ser criados livremente pela IA para descoberta orgânica de novos archetypes.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS lead_tags jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_applications_lead_tags ON applications USING gin(lead_tags);
