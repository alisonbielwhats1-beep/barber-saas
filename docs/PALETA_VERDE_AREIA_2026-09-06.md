# Everflair — verde e areia

## Direção aplicada

Pedido: recuperar a identidade cromática do produto, usar #126949 e #E8DED0,
remover a imagem do estabelecimento do cabeçalho administrativo e reduzir a
marca Everflair. A imagem do estabelecimento permanece no aplicativo do cliente.

- Botões principais: verde #126949, com texto areia no tema escuro e branco no claro.
- Tema escuro: superfícies verdes muito escuras em níveis distintos; destaque
  #82C6A6 para texto e seleção; gráfico de receita #61BD93.
- Tema claro: fundo quente #F3EDE4, cartões #FFFCF8 e superfícies secundárias #E8DED0.
- Indicadores: cores por família de informação, preservando alertas semânticos.
- Marca administrativa: 104 × 24 px; sem foto do estabelecimento ao lado.

Autenticação, cálculos financeiros, permissões e dados não foram alterados.

## Comparação com referências internacionais

Pesquisa limitada a materiais públicos, sem acesso às contas internas dos concorrentes.
A captura enviada pelo usuário fundamenta a avaliação do estado anterior do Everflair.

- Fresha: apresenta a agenda unificada como centro da operação. Aplicação ao
  Everflair: dar destaque reconhecível às ações da agenda e preservar sua leitura.
  Fonte: https://www.fresha.com/for-business/features/scheduling
- Timely: documenta comparações de desempenho com verde para melhora e vermelho
  para queda. Aplicação: separar identidade de marca das cores de estado e restaurar
  diferenciação visual dos indicadores.
  Fonte: https://help.gettimely.com/hc/en-gb/articles/1500002201662-Introduction-Introduction-Timely-dashboard-business-overview-tab
- Phorest: apresenta agenda, gestão e marketing como áreas complementares do produto.
  Aplicação: manter uma identidade consistente nas áreas operacionais, com acentos
  funcionais que ajudem a identificar a informação.
  Fonte: https://www.phorest.com/ca/features/

Não foi realizada uma auditoria visual completa das interfaces concorrentes.
A abertura do Fresha no navegador foi bloqueada pela rede corporativa.

## Verificação e publicação

- Lint e TypeScript: aprovados.
- Vitest: 659 testes aprovados, nenhum reprovado.
- Build de produção local: aprovado.
- npm audit: zero vulnerabilidades reportadas.
- Contraste calculado: areia sobre verde 5,02:1; branco sobre verde 6,68:1.
  Estes números não equivalem a uma auditoria completa de acessibilidade.
- Código final enviado à branch codex/everflair-demo no commit
  10872764897cb89d1b63c41056847940cd9c1d4b e compilado no Codespace.
- Conferência autenticada aprovada: seis verificações de fluxo, dez capturas
  desktop/mobile, zero erros de execução e zero violações nas regras axe
  WCAG 2 A/AA e 2.1 AA executadas. Isto não substitui uma auditoria manual completa.
- Corrigidos contrastes encontrados no primeiro passe: status e alerta no
  tema claro, iniciais no menu móvel, detalhes de horários na agenda e CTA
  do cliente. Partes do gráfico financeiro receberam nomes acessíveis.
- Inspeção visual das capturas do painel claro/escuro e app do cliente feita
  no editor da demonstração. Não houve acesso ao banco produtivo para testes.
- Relatório remoto: artifacts/audit-2026-09-06/refinement-browser-report.json;
  execução final: .demo/emerald-browser-final.log.
- Esta alteração de paleta não foi promovida a produção.

Trabalho local em codex/emerald-sand-refinement. Evidências de testes, build e
dependências em ../barber-saas/artifacts/release-2026-09-06/emerald-*.
