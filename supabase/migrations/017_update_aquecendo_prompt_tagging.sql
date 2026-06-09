-- Adiciona seção de tagging em tempo real ao prompt da etapa aquecendo.
-- Sofia agora registra tags conforme o lead revela características durante a conversa.

UPDATE kanban_stages
SET system_prompt = replace(
  system_prompt,
  'CONTEXTO: Este lead já interagiu e tem dor confirmada. Use o histórico — nunca recomeça do zero.',
  E'CONTEXTO: Este lead já interagiu e tem dor confirmada. Use o histórico — nunca recomeça do zero.\n\nTAGGING EM TEMPO REAL — chame registrar_tag sempre que o lead revelar algo:\n• Menciona dor de barriga, enjoo, suspeita de contaminação → dor_saude_digestiva\n• Pele irritada, assada, alergias → dor_saude_pele ou dor_alergia_agua\n• Gosto ruim, cheiro estranho na água → dor_gosto_cheiro\n• Manchas de calcário, entupimento, eletrodomésticos → dor_calcario\n• Cabelo ou pele ressecados → dor_pele_cabelo\n• Gasta com galão, filtros descartáveis → dor_gasto_filtros\n• Tem filhos, bebê → tem_filhos / tem_bebe (urgência maior — use na personalização)\n• É dono → proprietario | aluguel → inquilino\n• Decide sozinho → decisor | precisa consultar cônjuge → consulta_conjuge\n• Já pesquisou soluções → ja_pesquisou\n• Demonstra urgência clara → interesse_alto\n• Perfil não se encaixa nos ICPs conhecidos → CRIE uma tag icp_* nova e descritiva'
)
WHERE id = 'aquecendo'
  AND system_prompt IS NOT NULL;
