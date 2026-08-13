# Auditoria completa do front-end — handoff de continuidade

Atualizado em **11/08/2026**.

Este documento reúne a auditoria UX/UI do aplicativo do dono, as decisões de
direção visual, o primeiro incremento implementado e o contexto necessário
para continuar o trabalho em outra conversa ou conta do GPT.

> Estado importante: as mudanças descritas em “Primeiro incremento” estão na
> branch local `codex/agenda-mobile-a11y`. Não houve deploy, alteração de banco,
> migration, seed, mudança de autenticação ou escrita em Production.

## 1. Resumo executivo

O produto já apresenta uma identidade visual premium consistente: tema escuro
bem resolvido, verde esmeralda como cor principal, cartões sólidos, iconografia
Lucide e componentes Radix/Tailwind. O problema principal não é falta de
acabamento visual, mas excesso de informação com a mesma prioridade.

A recomendação central é evoluir o painel de uma coleção de métricas para um
sistema de decisão operacional:

- mostrar primeiro o que exige ação agora;
- separar operação diária de análise gerencial;
- reduzir duplicidade de números;
- tornar ações e estados mais claros no mobile;
- preservar identidade, regras de negócio, segurança e isolamento multi-tenant.

Prioridade máxima encontrada: a visão mensal da Agenda no mobile. Ela tentava
exibir até três agendamentos dentro de células com cerca de 37 px, texto de
10 px e alvos de aproximadamente 37 × 19 px. Os controles de visualização e de
navegação também não possuíam nomes acessíveis completos.

## 2. Escopo e método da auditoria

Foram inspecionadas e interagidas as 14 rotas do painel do estabelecimento:

1. `/dashboard`
2. `/agenda`
3. `/notificacoes`
4. `/servicos`
5. `/produtos`
6. `/pacotes`
7. `/portfolio`
8. `/clientes`
9. `/profissionais`
10. `/financeiro`
11. `/relatorios`
12. `/marketing`
13. `/compartilhar`
14. `/configuracoes`

O comportamento foi avaliado em 375, 390, 768, 1280 e 1440 px, nos temas
escuro e claro quando aplicável. Foram testadas as quatro visualizações da
Agenda, filtros, menus mobile, modais e fluxos de leitura. Nenhuma mutação de
negócio foi enviada durante a auditoria: não houve criação de agendamento,
alteração de status, exclusão, ajuste de estoque, campanha enviada ou mudança
de configuração.

Referências usadas:

- produção oficial: `https://salon-saas-ruby.vercel.app`;
- Preview público inspecionado durante a auditoria:
  `https://salon-saas-vuoh87uen-alisonbielwhats1-beeps-projects.vercel.app`;
- código local em `D:\Projetos\barber-saas`.

## 3. Diagnóstico transversal

### O que funciona bem

- identidade visual consistente e adequada ao segmento de beleza e bem-estar;
- tema claro também bem resolvido;
- sistema de cores e cartões já oferece boa base de evolução;
- Agenda detalhada possui boa arquitetura contextual;
- ações sensíveis da Agenda preservam confirmação e regras de negócio;
- notificações têm um estado vazio claro;
- fluxo manual de WhatsApp é seguro e coerente com a decisão de não adicionar
  automação paga;
- produtos no Preview já apresentavam botões de estoque nomeados e com 44 px;
- navegação mobile por “Mais” funciona;
- uso de Lucide, Radix e Tailwind deve ser mantido.

### Problemas recorrentes

- muitos cartões e métricas aparecem antes da primeira decisão útil;
- várias ações usam alvos menores que 44 px;
- textos utilitários e campos aparecem frequentemente com 12–13 px;
- controles somente com ícone nem sempre possuem nome acessível;
- páginas longas acumulam domínios distintos sem navegação interna;
- o tablet de 768 px mantém uma sidebar de aproximadamente 219 px, deixando
  só cerca de 540 px para o conteúdo;
- alguns padrões compartilhados ainda não têm uma política central de
  acessibilidade e tamanho.

### Métricas observadas

- Dashboard: aproximadamente 4169 px de altura em 375 px, 3675 px em 768 px e
  2075 px em 1280 px.
- Financeiro: aproximadamente 3201 px no mobile, 2501 px no tablet e 1468 px
  no desktop.
- Configurações: aproximadamente 4659 px no mobile, 4134 px no tablet e 3826 px
  no desktop.
- Sidebar, labels de grupo: contraste aproximado de 2,90:1 no escuro e 2,51:1
  no claro; abaixo do desejado para texto normal.
- Texto `muted-foreground` completo: contraste aproximado de 6,10:1 no escuro
  e 5,65:1 no claro; adequado.

## 4. Auditoria por rota

### Dashboard

Pontos observados:

- empilha bloco do dia, quatro KPIs, sete sinais, gráficos, divisão por gênero,
  base de clientes, ranking de serviços e equipe;
- a profundidade vertical e a equivalência visual entre seções escondem o que
  precisa de ação imediata;
- há valor nos dados existentes, mas falta uma ordem operacional explícita.

Direção: usar a alternativa híbrida descrita na seção 6, com uma “Faixa Agora”
como elemento principal e análises progressivamente reveladas.

### Agenda

Pontos observados:

- visão Dia é a base operacional mais forte;
- visão Semana exige rolagem horizontal no desktop intermediário (conteúdo de
  cerca de 1106 px dentro de aproximadamente 986 px);
- visão Mês no mobile era o único problema P0 da auditoria;
- visão Lista mostrava dados do mês, mas cabeçalho e navegação sugeriam um dia;
- controles Dia/Semana/Mês/Lista perdiam o nome acessível no mobile;
- botões anterior/próximo não tinham `aria-label`;
- modal de novo agendamento em 390 px tinha aproximadamente 390 × 717 px e
  rolagem interna, com labels adequados;
- os dados fictícios permitiram verificar dias 20 e 27 de julho de 2026 e abrir
  detalhes dos agendamentos.

Direção: no mobile, mês compacto com cada dia como alvo de toque e indicadores
de status; ao tocar, abrir a visão Dia. Manter detalhes de cliente/serviço fora
da célula mensal. Ações perigosas continuam exigindo confirmação e motivo
quando as regras existentes determinarem.

### Notificações

- estado vazio claro e bem hierarquizado;
- manter o padrão como referência para outros vazios;
- futuramente, o Toast compartilhado deve anunciar mensagens por `aria-live`
  ou `role=status` e nomear o botão de fechar.

### Serviços

- leitura geral consistente;
- ações somente com ícone entre aproximadamente 28 e 32 px;
- falta nome acessível em parte dessas ações;
- padronizar editar/excluir com tooltip, `aria-label`, foco visível e 44 px.

### Produtos

- fluxo de estoque melhorado no Preview: botões nomeados e com 44 px;
- página continua longa e mistura catálogo, estoque e ações;
- manter estoque como ação contextual, sem transformar cards em painéis densos.

### Pacotes

- controles somente com ícone em torno de 32–36 px;
- textos de expiração podem truncar;
- separar estado comercial, validade e consumo com hierarquia mais clara.

### Portfólio

- botão de exclusão em torno de 32 px e sem nome acessível;
- usa `window.confirm`, inconsistente com os diálogos do produto;
- modal de adicionar ocupava aproximadamente 390 × 847 px em viewport
  390 × 844;
- migrar exclusão para o diálogo compartilhado e adaptar o formulário mobile.

### Clientes

- foram observados cerca de 31 controles menores que 44 px;
- chips de filtro por volta de 32 px;
- atalhos de WhatsApp por volta de 32 px e alguns sem nome acessível;
- modal de cliente é rico, porém longo;
- organizar o detalhe em seções ou abas e fixar a ação primária quando útil.

### Profissionais

- apresentação visual consistente;
- números mensais zerados podem parecer conflitantes com dados de 30 dias do
  Dashboard;
- explicitar período e fonte em todas as métricas comparáveis.

### Financeiro

- quatro cards principais seguidos por seis métricas secundárias antes do
  primeiro gráfico;
- muitas cores e repetição de conceitos;
- “previsto”, “realizado”, “recebido” e “revertido” precisam permanecer
  semanticamente separados conforme `docs/DECISOES_PRODUTO.md`;
- usar a alternativa A da seção 6.

### Relatórios

- repete informações já presentes em Dashboard e Financeiro;
- filtros ficam comprimidos no mobile;
- tabela observada com aproximadamente 438 px dentro de contêiner de 337 px;
- relatórios devem aprofundar análise, não duplicar o painel principal.

### Marketing

- seletor mobile e destinatários visíveis funcionam no Preview;
- ações em torno de 36 px e campo de cupom pequeno;
- envio manual por WhatsApp é uma decisão segura e deve permanecer;
- nunca adicionar serviço pago ou automação sem autorização do responsável.

### Compartilhar

- página longa, com aproximadamente 2843 px no mobile;
- conteúdo interno chegou a aproximadamente 386 px em espaço disponível de
  371 px;
- emojis são usados como elementos estruturais;
- priorizar link, QR code e ações de compartilhamento; mover instruções
  secundárias para disclosure/accordion.

### Configurações

- maior problema é arquitetura da informação, não aparência;
- muitos domínios convivem em uma única página muito longa;
- dividir em navegação interna: Perfil, Aparência, Agenda, Notificações,
  Segurança e Assinatura/Plataforma quando esta última estiver autorizada;
- não ativar billing nem tocar na migration manual `011` por causa desta
  reorganização visual.

## 5. Priorização

### P0 — bloqueio de uso

1. Agenda mensal no mobile: células ilegíveis, ações pequenas e controles sem
   nomes acessíveis. **Corrigido localmente no primeiro incremento.**

### P1 — alto impacto

1. Redesenhar Dashboard como sistema de decisão.
2. Reduzir e reorganizar o Financeiro.
3. Dividir Configurações por domínio.
4. Criar política compartilhada de 44 px, nome acessível e foco visível.
5. Corrigir Toast e controles somente com ícone.
6. Rever comportamento do tablet com sidebar ampla.

### P2 — consistência e refinamento

1. Padronizar modais longos e ações destrutivas.
2. Reduzir duplicação entre Dashboard, Financeiro e Relatórios.
3. Reestruturar Compartilhar.
4. Melhorar labels de período em Profissionais e outras métricas.
5. Substituir emojis estruturais por Lucide quando houver equivalente.

## 6. Propostas de direção

### Dashboard — alternativa 1: operacional

Foco total na rotina do dia:

- próximo atendimento;
- atrasos e conflitos;
- clientes aguardando;
- horários livres relevantes;
- ações rápidas de confirmar, abrir ou criar;
- resumo financeiro compacto no fim.

Vantagem: melhor para recepção e operação intensa. Risco: reduz a leitura
executiva do dono.

### Dashboard — alternativa 2: executiva

Foco em desempenho:

- receita e comparação de período;
- ocupação e ticket médio;
- retenção e recorrência;
- serviços/equipe;
- alertas como seção secundária.

Vantagem: leitura gerencial clara. Risco: menos útil durante o atendimento.

### Dashboard — alternativa 3: híbrida, recomendada

Primeiro bloco: **Faixa Agora**, uma linha operacional com os próximos eventos,
exceções e ações imediatas. Depois:

1. quatro indicadores essenciais;
2. tendências e comparações;
3. serviços e equipe;
4. análises secundárias em disclosure ou rota de relatório.

Esta alternativa equilibra o dono que opera o salão e o dono que acompanha o
negócio. A “Faixa Agora” deve ser a assinatura visual da evolução do produto.

### Financeiro — alternativa A: posição e decisão, recomendada

Ordem sugerida:

1. posição do período: recebido, a receber e despesas;
2. resultado líquido;
3. alertas e pendências;
4. evolução temporal;
5. detalhamento por origem;
6. ações e lançamentos.

Usar cor principalmente para semântica financeira, não para decorar cada KPI.

### Financeiro — alternativa B: rentabilidade

Ordem sugerida:

1. margem e resultado;
2. serviços/profissionais mais rentáveis;
3. custos e comissões;
4. recebido versus realizado;
5. detalhamento.

É uma boa visão analítica futura, mas exige maior maturidade de custos e pode
confundir o uso operacional atual.

### Agenda — modelo recomendado

- Dia: linha do tempo operacional e ações contextuais.
- Semana: visão comparativa, com rolagem explícita quando inevitável.
- Mês mobile: mapa compacto, dias como alvos completos, contagem e pontos de
  status; tocar abre o dia.
- Mês desktop: grade detalhada, preservando leitura rápida.
- Lista: período mensal explicitado no cabeçalho e navegação.
- Status: cartão visualmente neutro, pequena faixa/ponto de cor e badge; evitar
  pintar grandes superfícies sem necessidade.

## 7. Sistema de design e componentes

Preservar:

- tema escuro premium e tema claro atual;
- verde esmeralda como ação principal;
- tokens semânticos já existentes;
- Lucide para iconografia;
- Radix para componentes interativos;
- Tailwind e padrões locais de composição.

Evoluir:

- alvo interativo mínimo de 44 × 44 px em fluxos mobile e ações principais;
- nenhum botão somente com ícone sem `aria-label` e tooltip visual quando útil;
- `aria-pressed` para filtros e seletores de modo;
- `aria-current=date` para o dia atual;
- foco visível consistente;
- inputs com label real, não apenas placeholder;
- Toast com região viva e botão de fechar nomeado;
- Command Palette baseada em diálogo com foco preso e retorno ao gatilho;
- ConfirmDialog compartilhado no lugar de `window.confirm`;
- modais longos com cabeçalho/rodapé estáveis e conteúdo rolável;
- tamanho utilitário preferencial de 13–14 px; 11–12 px apenas para metadados
  realmente secundários e com contraste suficiente.

Componentes candidatos a consolidação:

- `IconActionButton`;
- `PeriodNavigator`;
- `ViewSwitcher`;
- `FilterChip`;
- `MetricCard` com variantes limitadas;
- `EmptyState`;
- `StatusBadge`;
- `ResponsiveDialog`/`Drawer`;
- `SectionNav` para páginas longas.

## 8. Plano de implementação recomendado

### Fase 1 — Agenda mobile e acessibilidade

- calendário mensal compacto;
- nomes acessíveis e estados dos controles;
- alvos de 44 px;
- coerência mensal da Lista;
- testes e inspeção responsiva.

Estado: implementado localmente nesta branch.

### Fase 2 — Dashboard híbrido

- implementar Faixa Agora;
- limitar KPIs essenciais;
- ordenar exceções antes de análises;
- mover profundidade para relatórios/disclosures;
- não alterar consultas ou métricas sem validar sua semântica.

### Fase 3 — Financeiro

- aplicar alternativa A;
- remover duplicidade;
- manter previsto/realizado/recebido/revertido separados;
- validar clareza em mobile e tablet.

### Fase 4 — Configurações

- criar navegação por domínio;
- reduzir comprimento percebido;
- preservar Server Actions, autorização e flags existentes;
- não ativar billing.

### Fase 5 — componentes compartilhados

- botões de ícone;
- Toast;
- Command Palette;
- diálogos responsivos;
- filtros e navegação de período.

Estado em 13/08/2026: Toast, Dialog, Command Palette e coordenação do modal
mobile “Mais” foram implementados na candidata
`codex/commercial-maturity-wave1`; detalhes e gates estão na seção 14. Os
demais componentes candidatos continuam pendentes.

### Fase 6 — rotas de gestão

- Serviços, Pacotes, Portfólio, Clientes e Profissionais;
- corrigir ações pequenas e hierarquia dos detalhes;
- substituir confirmações nativas.

### Fase 7 — conteúdo e análise

- Relatórios, Marketing e Compartilhar;
- eliminar duplicações e overflow;
- tornar períodos e ações inequívocos.

### Fase 8 — verificação e rollout

- lint, TypeScript, testes e build;
- inspeção 375/390/768/1280/1440;
- teclado, foco, zoom e temas;
- PR, CI e Preview seguro;
- só promover após aprovação;
- verificar home, rota alterada e erros de runtime após deploy.

## 9. Primeiro incremento implementado

Branch:

```text
codex/agenda-mobile-a11y
```

Base:

```text
origin/master @ 60d6e7aa269085e644313f02c099d20788f5495d
```

Arquivos funcionais:

- `src/app/(admin)/agenda/agenda-board.tsx`
- `src/lib/frontend-source-regressions.test.ts`

Mudanças:

- criou calendário mensal específico para telas abaixo de 640 px;
- transformou o dia inteiro em alvo de toque de 48 px;
- adicionou contagem visível e até três pontos de status;
- adicionou descrição completa por leitor de tela, incluindo data, quantidade,
  “hoje” e indicação de dia fora do mês;
- preservou a grade detalhada a partir de 640 px;
- ampliou os botões de data do desktop/tablet para 44 px;
- nomeou anterior, hoje e próximo conforme dia/semana/mês;
- adicionou grupo “Visualização da agenda”, `aria-label` e `aria-pressed` aos
  modos Dia/Semana/Mês/Lista;
- ampliou modos de visualização, filtros e busca para 44 px;
- adicionou label acessível à busca;
- marcou a data atual com `aria-current=date`;
- fez a Lista declarar e navegar pelo mês, coerente com os dados exibidos;
- substituiu soma fixa de 30 dias por `addMonths`, evitando pular fevereiro em
  datas como 31 de janeiro;
- adicionou teste de regressão de fonte para o novo contrato mobile/a11y.

Não alterado:

- banco e Prisma schema;
- migrations;
- APIs e Server Actions;
- autenticação e autorização;
- regras de tenant;
- estados ou transições de agendamento;
- Production, Vercel ou Supabase.

## 10. Evidências desta implementação

Comandos concluídos:

```text
npm run lint
Resultado: passou.

npx tsc --noEmit --incremental false
Resultado: passou.

npx vitest run src/lib/frontend-source-regressions.test.ts --reporter=verbose
Resultado: 1 arquivo, 5 testes passaram.

npm test
Resultado: 58 arquivos, 276 testes passaram.

npm run build
Resultado: passou com Next.js 15.5.22 e Prisma Client 5.22.0.
```

Observação do build: a primeira tentativa encontrou `EPERM` na DLL do Prisma
porque um servidor Next local antigo ainda mantinha o arquivo aberto. O servidor
foi encerrado e o mesmo build passou integralmente. Não era erro de código.

Verificação visual local com dados fictícios:

| Viewport | Calendário | Alvo mínimo | Overflow horizontal | Overlay/console |
|---|---|---:|---|---|
| 375 px | compacto | 48 px nos dias; 44 px nos modos | não | sem erros |
| 390 px | compacto | 48 px nos dias; 44 px nos modos | não | sem erros |
| 768 px | detalhado | 44 px nos dias | não | sem erros |
| 1280 px | detalhado | 44 px nos dias | não | sem erros |
| 1440 px | detalhado | 44 px nos dias | não | sem erros |

Também foi confirmado semanticamente:

- cada dia anuncia data e quantidade de agendamentos;
- o modo Mês expõe `aria-pressed=true` quando ativo;
- tocar em um dia troca para Dia antes da navegação;
- Lista usa “julho 2026” e botões “mês anterior/próximo mês”;
- a página tem conteúdo significativo e não mostra overlay de erro.

Para a inspeção visual foi criada uma rota local temporária com dados
fictícios. Ela foi removida ao final e não faz parte do diff.

## 11. Estado do repositório e cuidados

Antes de continuar:

1. ler integralmente `AGENTS.md`, `docs/STATUS_ATUAL.md`,
   `docs/AMBIENTES.md`, `docs/DECISOES_PRODUTO.md` e o documento da fase;
2. confirmar `git status -sb`, branch e `origin/master`;
3. inspecionar o diff já existente e preservar mudanças do usuário;
4. não usar Production como teste;
5. não executar seed, reset, `prisma db push` ou migration destrutiva;
6. não alterar RLS, autorização ou isolamento multi-tenant;
7. não ativar `PLATFORM_BILLING_ENABLED` nem aplicar a migration `011`;
8. não adicionar WhatsApp/SMS automático ou serviço pago sem autorização;
9. implementar um incremento por vez e pedir aprovação antes de mudar a direção.

## 12. Prompt pronto para a próxima conversa

Copie o texto abaixo para iniciar a continuidade:

```text
Continue a evolução UX/UI do Salon SaaS no repositório
D:\Projetos\barber-saas. Leia integralmente AGENTS.md,
docs/STATUS_ATUAL.md, docs/AMBIENTES.md, docs/DECISOES_PRODUTO.md,
docs/fase-2-agenda-confiavel.md e
docs/AUDITORIA_FRONTEND_HANDOFF_2026-08-11.md antes de agir.

A branch local esperada é codex/agenda-mobile-a11y, criada de
origin/master @ 60d6e7aa269085e644313f02c099d20788f5495d. Primeiro confira
git status -sb e o diff. A Fase 1 da auditoria já implementou o calendário
mensal mobile da Agenda e sua acessibilidade. Lint, TypeScript, 276 testes,
build e verificação visual em 375/390/768/1280/1440 passaram.

Não altere banco, migrations, Production, Supabase, autenticação, RLS ou regras
de negócio. Não aplique a migration 011 e não ative billing. Preserve os
helpers tenant-scoped. Comece revisando e finalizando o incremento da Agenda;
depois proponha a menor implementação da Fase 2: Dashboard híbrido com a
“Faixa Agora”, sem inventar métricas e sem duplicar o Financeiro. Espere minha
aprovação antes de ampliar o escopo ou publicar/deployar.
```

## 13. Segundo incremento implementado — Dashboard híbrido

Estado em **11/08/2026**, na mesma branch local
`codex/agenda-mobile-a11y`:

Arquivos funcionais:

- `src/app/(admin)/dashboard/page.tsx`;
- `src/app/(admin)/dashboard/now-strip.tsx`;
- `src/lib/frontend-source-regressions.test.ts`.

Mudanças:

- substituiu os dois painéis equivalentes do topo pela **Faixa Agora**;
- usa somente os próximos atendimentos e as métricas que o Dashboard já
  carregava, sem consulta, cálculo ou semântica financeira nova;
- destaca o atendimento em curso, diferencia confirmado e pendente e torna
  cada cartão um link nomeado para a Agenda do dia;
- preserva alvos de pelo menos 44 px e foco visível;
- no mobile, apresenta os atendimentos em trilho horizontal com snap, evitando
  empilhar quatro cartões e alongar a primeira decisão;
- mantém receita concluída hoje, agendamentos de hoje e de amanhã dentro do
  contexto operacional;
- eleva estoque em falta a exceção acionável sem inventar alertas;
- preserva quatro KPIs essenciais e a evolução temporal antes de serviços e
  equipe;
- move sinais do período, recorte de público e base de clientes para
  `details/summary`, fechados por padrão;
- oferece acesso explícito a `/relatorios` para aprofundamento;
- extrai a Faixa Agora como Server Component de apresentação, sem hooks,
  bundle de cliente, nova dependência ou waterfall.

Não alterado:

- consultas, métricas e regras de negócio do Dashboard;
- APIs, Server Actions, banco, schema Prisma ou migrations;
- autenticação, autorização, RLS ou isolamento multi-tenant;
- billing, migration manual `011`, Vercel, Supabase ou Production.

Evidências:

```text
npm run lint
Resultado: passou.

npx tsc --noEmit --incremental false
Resultado: passou.

npm test
Resultado: 58 arquivos e 277 testes passaram.

npm run build, com variáveis locais fictícias e banco em loopback
Resultado: passou com Next.js 15.5.22 e Prisma Client 5.22.0; 40 páginas.
```

A primeira tentativa de build encontrou `EPERM` no engine do Prisma porque um
`next dev` local antigo ainda mantinha a DLL aberta. O grupo de processos foi
identificado como o app deste repositório na porta 3001, já estava inválido por
cache `.next` inconsistente, foi encerrado e o Prisma passou. Uma tentativa sem
variáveis locais parou corretamente por ausência de `NEXTAUTH_SECRET`; a
repetição usou apenas placeholders locais já previstos para build e passou.

Verificação visual local com dados fictícios:

- desktop em 1280 px: Faixa Agora, quatro atendimentos, KPIs e disclosure
  renderizaram sem overlay ou erro de console;
- mobile em 390 × 844: conteúdo significativo, documento sem overflow global
  (`scrollWidth` 375 para corpo de 375 px), alvos da Agenda de 44 px ou mais,
  disclosure fechado e sem overlay/erro de console;
- a inspeção mostrou que quatro cards empilhados alongavam demais a Faixa;
  o componente foi refinado para trilho horizontal mobile. A segunda captura
  após o refinamento foi bloqueada pela política de URL local do navegador;
  não houve tentativa de contorno. O contrato do trilho foi coberto por teste
  de regressão, TypeScript, lint e build;
- a rota local fictícia, logs e processos temporários foram removidos ao final.

Próximo incremento recomendado: aplicar a alternativa A ao Financeiro,
preservando estritamente a separação entre previsto, realizado, recebido e
revertido. Não ampliar para migration ou billing.

## 14. Wave1 frontend candidata — disponibilidade e componentes compartilhados

Estado em **13/08/2026**, na branch local
`codex/commercial-maturity-wave1`. Esta seção não altera o histórico dos dois
incrementos anteriores e não significa CI ou deploy.

### Disponibilidade do cliente

- `200` com `slots=[]` é tratado como agenda vazia válida;
- `429`, timeout, rede, `500`, JSON inválido e contrato incompleto exibem erro
  próprio, preservam as escolhas e oferecem retry;
- `Retry-After` aceita delta-seconds e HTTP-date com limite máximo; enquanto o
  cooldown está ativo, o botão mostra contagem e permanece bloqueado;
- requests recebem `AbortSignal` e id crescente; resposta antiga não substitui
  profissional/data/serviços atuais;
- horário restaurado carrega uma `queryKey` com salão, serviços, profissional e
  data; qualquer troca explícita invalida a seleção pendente;
- o CTA só habilita se o slot existir na resposta vigente.

### Toast, Dialog, palette e mobile

- Toast mantém regiões vivas persistentes `polite` e `assertive`, separa
  severidade sem anúncio duplicado, limpa fila/timers e pausa expiração em
  hover ou foco;
- fechar Toast preserva o foco na próxima notificação ou no alvo de origem;
- botões de fechar de Toast/Dialog têm nome acessível e alvo de 44 px;
- Command Palette usa Dialog modal, foco inicial no combobox, trap, Escape,
  navegação por setas/Enter e retorno ao gatilho;
- toda abertura da palette passa por um evento cancelável. Se “Mais” estiver
  aberto, MobileNav fecha primeiro e só então reabre a palette com o botão
  “Mais” como retorno estável;
- a coordenação cobre o botão Buscar, rota atual e `Ctrl/Cmd+K`, garantindo um
  único dialog/overlay/focus trap.

### Evidências locais e limites

- testes DOM focados passaram com 24 cenários na onda frontend, incluindo
  promises fora de ordem, retry, múltiplos `429`, troca de query no cooldown,
  unmount, teclado, foco e modais mobile;
- lint, TypeScript, suíte completa e build local passaram após o retrabalho
  frontend; a suíte completa tinha 69 arquivos e 433 testes naquele ponto;
- após todos os retrabalhos e a crítica de integração, a suíte local passou com
  70 arquivos e 446 testes; lint, TypeScript e o build completo do Next.js
  15.5.22 também passaram, gerando 41 páginas;
- não havia staging autenticável nem banco seguro para browser real nesta
  máquina. Não se usou Production e não se contornou o Environment Guard;
- Preview, comparação visual final autenticada, CI e deploy permanecem
  pendentes até evidência verificável.
