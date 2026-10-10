# Experiência de aplicativo no celular — 07/10/2026

Pedido do responsável: transformar o uso no celular numa experiência de
aplicativo (mobile-first, app-like), não apenas um layout responsivo.
Preservar funcionalidades, regras de negócio, backend, APIs, banco e
identidade visual. Esta fase mexe só na camada de interface.

Ambiente da análise: worktree `claude/wizardly-moore-26816c`, banco PostgreSQL
descartável próprio (loopback `127.0.0.1:55461`, dados fictícios do
`prisma/seed.ts`), viewport 375×812 nos dois temas. Production não acessada.

## 1. Telas analisadas

| Tela | Estado no celular |
|---|---|
| Hoje | Cabeçalho de página web (selo "Operação", título, data, pílulas "Anterior"/"Agenda completa", linha divisória), cartão "Receber atendimentos", quatro cartões de resumo em grade 2×2. A lista de atendimentos começa abaixo da primeira tela. Cada cartão tem até seis botões quebrando em três linhas. |
| Agenda | Já tem cara de app: faixa da semana, alternância Dia/Semana/Mês/Lista, "+" flutuante. O "+" abre um menu suspenso de computador; a alternância usa quatro pílulas soltas. |
| Clientes, Serviços, Produtos, Equipe | Listas limpas com busca e "+" flutuante (PR #93). Busca sem `type="search"`/`enterKeyHint`. |
| "Mais" | Gaveta lateral de site (menu hambúrguer) com acordeões por área. Ao entrar num módulo não há como voltar: só reabrindo a gaveta. |
| Financeiro, Notificações, Relatórios, Marketing, Pacotes… | Mesmo cabeçalho de página web do computador; sem barra de app nem voltar. |
| Configurações | Já usa listas agrupadas no estilo de ajustes do celular (boa referência). |
| Formulários (Novo cliente, despesa, produto…) | Janela centralizada flutuando no meio da tela. Só cinco janelas usam painel inferior (`mobileSheet`). |
| Confirmações | Janela pequena centralizada com botões pequenos. |
| Avisos (toast) | Aparecem por cima da barra inferior. |
| App do cliente | Já é app: barra inferior com "Agendar" em destaque. A tela inicial fica como está (decisão de 06/10). |

## 2. O que ainda parece site/formulário

1. Navegação secundária como gaveta lateral com acordeões, sem pilha de telas nem voltar.
2. Cabeçalhos de página de computador (selo, título, descrição, divisória) em vez de título grande + barra compacta.
3. Janelas centralizadas em vez de painéis inferiores; sem alça nem gesto de arrastar para fechar.
4. 31 `<select>` nativos no painel com cara de formulário administrativo.
5. Cartões de Hoje com muitos botões soltos; ações secundárias sem menu de contexto.
6. Resumo numérico ocupando a primeira tela inteira em Hoje.
7. Botões "+" flutuantes de tamanhos e alturas diferentes (52 px a 84 px do fundo; 44 px a 72 px na agenda); entre 768 e 1023 px some o "+" das listas.
8. Sem esqueleto de carregamento por tela, sem estado vazio padronizado, sem retorno visual de toque.
9. Campos de busca, telefone e valor sem `type`, `inputMode`, `autoComplete` e `enterKeyHint` adequados.

## 3. Arquitetura de navegação proposta (painel, abaixo de 1024 px)

```
┌───────────────────────────────┐
│ ‹ Mais      Financeiro     🔍 │  barra compacta (só em telas filhas)
├───────────────────────────────┤
│ Financeiro                    │  título grande, rola com o conteúdo
│ …                             │
│                          (+)  │  ação principal da tela (FAB único)
├───────────────────────────────┤
│ Hoje  Agenda  Clientes Avisos Mais │  barra de abas fixa
└───────────────────────────────┘
```

- **Abas (máx. 5):** Hoje · Agenda · Clientes · Avisos · Mais. Profissional
  (sem acesso a Hoje): Agenda · Clientes · Avisos · Mais. Avisos leva o
  contador de não lidas que antes ficava em "Mais".
- **Mais deixa de ser gaveta lateral** e vira um painel de app que sobe de
  baixo (ver seção 5): cartão do estabelecimento (troca de salão, plano,
  tema), busca global, grupos Equipe, Catálogo, Resultados, Crescimento e
  Ajustes em listas agrupadas, perfil e Sair no fim.
- **Telas filhas** (Financeiro, Produtos, Relatórios…) ganham barra compacta
  com "‹ Mais" (reabre o painel) e o título aparecendo quando o título grande
  sai da tela.
- **Ação principal por tela:** um único botão flutuante de 56 px, sempre na
  mesma posição acima da barra de abas.
- **Computador:** barra lateral e cabeçalhos atuais preservados.

## 4. Componentes adaptados ou substituídos

| Componente | Mudança |
|---|---|
| `DialogContent` | Dentro do painel (`DialogMobileSheetDefault` em `(admin)/layout.tsx`) vira painel inferior no celular: alça, entrada de baixo para cima, arrastar para baixo fecha, área segura. Fora do painel (páginas públicas, plataforma, HQ) o padrão continua a janela centralizada de produção. A prop `mobileSheet` explícita sempre vence; a busca (Ctrl+K) usa `mobileSheet={false}`. Computador continua centralizado. |
| `ConfirmDialog` | Folha de ação: ícone, texto e botões grandes empilhados. |
| `Toaster` | Acima da barra de abas no celular. |
| `MobileTabBar` (novo) | Substitui a barra de 3+1 itens; indicador ativo, contador, toque com retorno visual. |
| `MoreScreen` + `/mais` (novos) | Substituem a gaveta lateral no celular. |
| `MobileTopBar` (novo) | Barra compacta com voltar e título que surge ao rolar. |
| `SegmentedControl` (novo) | Filtros de Hoje e visualização da Agenda. |
| `SelectSheet` (novo) | Seleção em painel inferior no celular; `<select>` nativo no computador. |
| `ActionSheet` (novo) | Ações de contexto (cartão de Hoje, "+" da Agenda). |
| `SwipeRow` (novo) | Deslizar cartão de Hoje revela WhatsApp e Ligar (só toque; as mesmas ações continuam acessíveis por botão). |
| `Skeleton`, `EmptyState` (novos) | Carregamento por tela e estados vazios padronizados. |
| Campos | `type="search"`, `enterKeyHint`, `autoComplete="tel"`, `inputMode` corretos. |

Regras preservadas: nenhuma ação nova no servidor; mesmas server actions,
mesmas permissões por papel (a UI só esconde, o servidor continua validando),
mesmas cores (verde de ação, lilás só marca/seleção), sem mudança no banco.

## 5. Resultado desta fase

Ajuste feito durante a implementação: o "Mais" ficou como **painel que sobe
de baixo** (não rota `/mais`). Ele mantém os contratos de acessibilidade já
testados (gatilho "Abrir todos os módulos", janela "Todos os módulos", foco
preso, Esc devolve o foco, Busca fecha o "Mais" antes de abrir) e as jornadas
de ponta a ponta continuam válidas. O "voltar" das telas filhas reabre o "Mais".

### Primitivas (valem para painel e app do cliente)

- `src/components/ui/dialog.tsx`: dentro do painel administrativo, toda janela vira
  painel inferior abaixo de 768 px (padrão vindo de `DialogMobileSheetDefault`;
  fora do painel o padrão é a janela centralizada de produção), com alça, entrada de baixo para cima e
  arrastar para baixo fecha como o X (formulários com alteração continuam
  pedindo "Descartar alterações?"). A alça fica depois do conteúdo para não
  quebrar seletores `:first-child` existentes.
- `src/app/mobile-app.css`: animação dos painéis, retorno de toque (`press`,
  `press-row`), barra de abas, barra superior e botão flutuante único (`app-fab`).
- `ConfirmDialog`: folha de ação com botões grandes empilhados.
- `Toaster`: acima da barra de abas (`--mobile-dock`).
- `Button`: leve redução ao toque (desligada com movimento reduzido).
- Novos: `SegmentedControl`, `ActionSheet`, `SelectSheet`, `SwipeRow`,
  `Skeleton`/`SkeletonRow`, `EmptyState`, `useMediaQuery`/`useIsMobile`.

### Painel do estabelecimento

- **Barra de abas** (`mobile-nav.tsx`, `mobile-navigation.ts`): Hoje · Agenda ·
  Clientes · Avisos · Mais; profissional sem Hoje. Pílula ativa, contador de
  não lidas em Avisos.
- **"Mais"**: título, cartão da conta (plano, tema, estabelecimento), Busca,
  grupos Equipe/Catálogo/Resultados/Crescimento/Ajustes com ícones, perfil e
  Sair. Cada módulo aparece uma vez (Serviços só em Catálogo).
- **Barra superior compacta** (`mobile-top-bar.tsx`): fixa ao rolar, título
  aparece quando o título grande sai da tela, "‹ Mais" nas telas filhas,
  Busca e tema no topo (decisão de tema no topo também no celular). Hoje e
  Agenda mantêm o próprio topo.
- **Hoje**: data com botões redondos, filtros em controle segmentado com
  contagem (os quatro cartões de resumo viram uma faixa compacta, com "Em atendimento";
  a cor da agenda fica num botão de paleta na linha dos filtros), lista já na primeira
  tela, cartão com uma ação principal larga + WhatsApp + Ligar + "⋯" (chegada,
  falta, detalhes em folha de ação). Recebimento em lote vai para o fim da tela.
- **Agenda**: Dia/Semana/Mês/Lista em controle segmentado; o "+" abre folha
  de ações "Criar na agenda".
- **Avisos**: deslizar um aviso não lido para a esquerda marca como lida (o
  botão "Marcar lida" continua no cartão); estado vazio padronizado.
- **Listas** (Clientes, Serviços, Produtos, Equipe): mesmo "+" de 56 px na mesma
  posição; títulos grandes sem divisória nem selo.
- **Campos**: buscas com `type="search"`, `enterKeyHint="search"`,
  `autoComplete="off"`; telefones com `type="tel"`, `inputMode="tel"`,
  `autoComplete="tel"`. Seletores em painel no celular: gênero do cliente,
  categoria e tipo da despesa, campanha de marketing e período dos
  resultados. Campos de preço `type="number"` ficaram como estavam: o teclado
  decimal com vírgula no Safari pode esvaziar o valor.
- **Carregamento**: esqueletos no formato de cada tela (lista, agenda, Hoje).

### App do cliente

Somente o acabamento da barra inferior (pílula ativa larga, toque com retorno)
(as janelas do app do cliente continuam centralizadas como em produção: o padrão
de painel inferior vale só dentro do painel administrativo). A tela inicial do cliente não
foi alterada (decisão de 06/10).

### Fora desta fase (próximas)

- Seletores ainda nativos usados pelas jornadas de ponta a ponta no celular
  ("Repetir" de bloqueio, "Tipo de preço", visita conjunta, filtro de
  avaliações): trocar junto com os testes.
- Detalhe do agendamento (`appointment-detail.tsx`, 991 linhas) e comanda em
  telas de app; fluxo de agendamento do cliente.
- Teste em aparelho físico (iPhone/Android) via Preview com HTTPS.

### Verificação

Ver o PR desta branch: comandos e resultados de lint, TypeScript, Vitest e
build, mais capturas em 320/375/1280 px nos dois temas (banco local
descartável com o seed fictício; Production não acessada).
