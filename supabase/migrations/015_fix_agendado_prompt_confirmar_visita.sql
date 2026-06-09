-- Substitui referências à tool confirmar_visita (removida) pelo novo mover_para_agendado gateado.
-- A tool confirmar_visita foi fundida em mover_para_agendado, que agora exige
-- data_visita + horario_visita + local_visita como parâmetros obrigatórios.

UPDATE kanban_stages
SET system_prompt = replace(replace(
  system_prompt,
  'Chame confirmar_visita com data/hora/endereço',
  'Chame mover_para_agendado com data_visita, horario_visita e local_visita'
),
  E'→ confirmar_visita            — todos os 5 itens confirmados\n→ notificar_agendamento_ze    — chamar junto com confirmar_visita',
  E'→ mover_para_agendado         — todos os 5 itens confirmados (obrigatório: data_visita, horario_visita, local_visita)\n→ notificar_agendamento_ze    — chamar junto com mover_para_agendado'
)
WHERE id = 'agendado'
  AND system_prompt LIKE '%confirmar_visita%';
