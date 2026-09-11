# Listas operacionais no celular

Solicitação do responsável: retirar cards redundantes e priorizar clientes,
serviços, profissionais e avaliações no painel mobile. Branch
`codex/mobile-list-cleanup`, base `e3e8ad5` (PR #93 publicado).

## Auditoria anterior

Capturas do CI 34550786407 em 390px: clientes iniciam aproximadamente em y=596,
serviços em y=385, primeiro profissional em y=405 com métricas ocupando o
restante da tela. A lista de avaliações fica abaixo da primeira viewport.
Categorias e filtros quebravam em múltiplas linhas. Profissionais usavam
truncamento de nome e não possuíam busca.

## Mudança

- Clientes: sem KPIs no mobile; busca e botão de filtros. Segmento em seletor,
  importação dentro dos filtros, histórico e ações existentes preservados.
- Serviços: busca e filtros recolhidos, categoria em seletor e lista contínua
  sem cabeçalhos/banners por categoria no mobile. Salas/equipamentos após a lista.
  Preço inicial explícito e menu de edição preservados.
- Profissionais: busca, nomes com quebra, colunas com largura mínima zero;
  resumo da equipe fora da abertura mobile e desempenho recolhido por pessoa.
  Convites após a lista, ações operacionais disponíveis no próprio perfil.
- Avaliações: nota média compacta, quantidade e filtro, lista imediatamente
  abaixo. Distribuição, KPIs e orientações extensas continuam no desktop.
- Breakpoint mobile abaixo de 768px, mantendo a identidade e os controles
  existentes. Sem alteração em schema, banco, regras de acesso ou mutações.

## Validação e rollout

Lint, TypeScript, Vitest e build obrigatórios. CI com testes existentes e nova
jornada em 320/390/430px nos temas claro/escuro: lista antes de y=320, ausência de
overflow horizontal, nomes longos, 12 categorias, filtros, menu e desempenho;
axe e capturas. Dados exclusivos de tenant sintético no PostgreSQL descartável.
PR/CI/Preview antes de promoção; esta implementação não representa deploy.
