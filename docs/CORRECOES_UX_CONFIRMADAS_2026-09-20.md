# Correções confirmadas de UX — 20/09/2026

## Escopo e ambiente

Implementação consolidada autorizada dos P1/P2 confirmados do painel do dono,
sobre a candidata do PR #111 (commit de origem dfb74e6), na branch
`codex/ux-confirmed-fixes`. Não é uma publicação de produção.
A Skill `everflair-ux-design-review` foi aplicada à revisão resultante.
O checklist da Skill orientou a avaliação; nenhuma hipótese foi convertida em redesign.

Foram preservados contratos das server actions, APIs, consultas de domínio,
schema, autenticação, permissões, billing e integrações. Não houve escrita de
dados produtivos, migration, seed ou alteração de regras.

## Antes e depois: correções confirmadas

| Prioridade / problema | Antes | Depois / critério de aceite |
|---|---|---|
| P1 Pacotes: seleção executava operação | Escolher cliente já efetivava venda/assinatura | Seleção apenas prepara a revisão; nome, oferta e condições precedem Confirmar operação. Cancelamento, renovação, consumo e exclusão têm confirmação explícita. |
| P1 Rascunhos | X/Escape podiam descartar cadastro | Contrato compartilhado nos cadastros de cliente, serviço, produto, profissional, pacote, plano, portfólio, jornada e despesa; continuar preserva dados e foco, descarte exige decisão. Fechamentos recolhidos permanecem montados. |
| P1 Acessibilidade | Labels sem associação; etapas sem foco; ações em hover | Associações explícitas nos formulários revisados, foco ao mudar etapa, retorno do foco após confirmação e ações permanentes no Portfólio. |
| P1 Histórico | Falha confundida com ausência de atendimentos | Loading, erro, resposta vazia e dados separados; retry no mesmo cliente; proteção contra respostas fora de ordem. |
| P1 Estoque | Cadastro sugeria silenciosamente 10 unidades | Campo inicial vazio e obrigatório, aceita zero explícito. Era default exclusivo do formulário, não regra da action; schema default zero. Mínimo e movimentação preservados. |
| P2 Clientes | Essencial exigia passagem por complementares | Nome pode concluir o cadastro; dados complementares recolhíveis e montados. Busca normaliza acentos e telefone. |
| P2 Serviços | Edição simples percorria etapas avançadas | Formulário direto; avançado sob demanda; falha ao carregar recursos oferece retry sem perder seleção. |
| P2 Produtos | Wizard obrigatório para edição simples | Cadastro/edição diretos; estoque existente continua não editável pelo cadastro, com movimentação no fluxo próprio. |
| P2 Profissionais | Catálogo grande pouco pesquisável; jornada perdia profissional | Busca de serviços quando há mais de seis, contagem de selecionados e seleções mantidas. Jornada abre contexto do profissional em Configurações. |
| P2 Agenda | Filtro de equipe apenas todos/um | Subconjunto selecionável; todos continua disponível. Grade e dimensões temporais intactas. |
| P2 Hoje/Notificações | Link abria Agenda sem objeto | ID, data e origem acompanham a navegação; retorno contextual. Payload já contém appointmentId. |
| P2 Financeiro | Operação frequente escondida com análise; gráfico duplicado | Recebimentos e despesas diretamente acessíveis; análises recolhíveis; uma composição de fluxo de caixa; duas colunas no desktop. |
| P2 Relatórios | Assuntos misturados e rótulo fixo | Resultado/operação e retenção separados; período explícito e rótulo usa lapsedClientDays real. |
| P2 Marketing | Explicação precedia operação | Campanhas primeiro; orientação, configuração e indicadores auxiliares sob demanda. |
| P2 Portfólio | Ações dependiam de hover e imagem genérica parecia trabalho real | Editar/excluir visíveis sem hover; ausência/falha de imagem mostra placeholder neutro. |
| P2 Configurações | Políticas misturadas ao cadastro frequente | Políticas de cancelamento/janela sob demanda; busca e agrupamentos preservados. |
| Sistêmico | Pending de useTransition não acompanha await no React 18 | Estado de processamento e trava por ref nos formulários alterados, erro inline, retry e feedback de sucesso. |
| Quick wins | Mais não indicava rota secundária; skeleton genérico | Mais sinaliza área ativa; skeleton ajustado à classe de rota. Guia de assinatura sob demanda. |

## Validação automatizada

- Lint: aprovado.
- TypeScript sem emissão: aprovado.
- Vitest: 212 arquivos, 1.129 testes aprovados, incluindo sete novos testes.
- Build Next.js: aprovado; variáveis de teste locais, sem banco produtivo.
- Diff check: aprovado.
- Os novos testes cobrem cadastro essencial, X/Escape/descarte, preservação do
  rascunho após falha, bloqueio durante await e contra envio repetido, estoque
  explícito, confirmação de Pacotes, estados/retry do histórico e busca normalizada.
- Nenhum contrato de domínio, API ou schema foi alterado. A suíte existente
  verifica regressões automatizadas; não equivale a homologação transacional real.

## Design QA executado

Prévia local com componentes reais e fixtures, ações de escrita substituídas
por stubs. Não é um ambiente autenticado integrado.

- Sete telas: Clientes, Serviços, Produtos, Profissionais, Financeiro, Relatórios,
  Agenda. 77 combinações de tela/largura sem overflow horizontal do documento.
- Larguras: 320, 360, 375, 390, 430, 768, 1024, 1280, 1366, 1440, 1920.
- Formulários Cliente/Serviço/Produto nas 11 larguras: sem overflow horizontal e
  CTA dentro da janela de 844 px de altura.
- Produto em 320 × 480: diálogo de 464 px, CTA terminando em y=456, rolagem interna.
- Escape abre confirmação; continuar devolve foco ao Nome e preserva o rascunho;
  descartar devolve foco ao botão de abertura.
- Busca por Joao encontra João; filtro de equipe mantém dois profissionais
  escolhidos sem restringir o conjunto total da equipe.
- Financeiro: leitura limitada no desktop, resumo em quatro colunas a partir de
  xl e gráfico/pagamento lado a lado a partir de lg; mobile mantém ordem da tarefa.
- Console da prévia: nenhuma mensagem de erro ou warning capturada.
- Viewport temporário restaurado após QA.

Limites: teclado virtual físico, leitor de tela, gestos/safe areas de dispositivos
reais, latência/rede real, gravação e recuperação após resposta do servidor,
todas as rotas autenticadas e CI/Preview remoto não são certificados pela prévia.
Financeiro usa stubs para os módulos de recebimento/despesa; seus destinos foram
conferidos no código, não como transações no navegador.

## Auditoria pós-implementação — veredito

O pacote reduz características de CRUD nos cadastros de Cliente, Serviço e
Produto: essencial → complementar sob demanda → ação → feedback. Pacotes passa
a separar escolha de compromisso. A Agenda mantém as decisões reais em três
etapas. Isso melhora orientação a tarefas sem exigir novo design visual.

### Pontos fortes e o que manter

Identidade, cores e dark mode; Agenda multiprofissional e grade temporal;
Cliente → Serviços → Revisão, contexto de horário e confirmação; proteção
existente de descarte da Agenda; diretórios pesquisáveis; perfil compacto do
cliente; onboarding com decisões reais; busca/agrupamentos de Configurações;
disponibilidade, estoque, faturamento, permissões e integrações; formulários
curtos já adequados. Radius, sombras, fotos e listas/cards não foram redesenhados.

### Problemas sistêmicos e estruturais tratados

Descarte, processamento, estado de erro e repetição de envio foram centralizados
para os cadastros cobertos. A organização dos formulários foi alterada mantendo
campos montados, valores opcionais e payload. A mudança estrutural é de fluxo e
hierarquia, não de regras ou arquitetura de dados.

### Mobile, tablet e desktop

Mobile prioriza formulário direto e ação acessível; altura útil pode rolar
internamente sem esconder o rodapé. Tablet aproveita campos em colunas quando
há largura. Desktop limita leitura e usa comparação em Financeiro. Rolagem
legítima de grade, catálogo, histórico e equipe foi mantida.

### Acessibilidade, estados e consistência

Labels/foco e ações sem hover corrigidos no escopo confirmado. Estados de
histórico e processamento têm evidência automatizada; descarte/foco também
foram exercitados no navegador. Não constitui certificação WCAG nem prova de
todas as combinações de tecnologia assistiva.

### Restante e decisões necessárias

Não foi identificada dependência obrigatória de nova regra/backend para o
pacote implementado. Estoque inicial foi resolvido com evidência do contrato
existente. Itens não confirmados e preferências estéticas permanecem inalterados.

Pendência de validação, não defeito confirmado: homologação autenticada em
ambiente não produtivo e dispositivos reais. Não atribuir P0/P1 inventados à
ausência desse teste; também não afirmar ausência de defeitos em áreas não
exercitadas. Promoção só após revisão e autorização, sem publicar nesta entrega.

Próximo passo recomendado: revisar o diff consolidado e homologar os fluxos
integrados fora de produção. Não iniciar outro redesign ou microetapas.


## Inventário de arquivos alterados

### Entrega local e impedimento remoto

Implementação registrada no commit `65a7246`. O push da branch foi recusado
pelo GitHub com HTTP 403: a conta autenticada `AlisonBSilva24` não tem permissão
de escrita no repositório `alisonbielwhats1-beep/barber-saas`. Nenhum PR novo,
CI remoto ou Preview dessa branch foi criado; não houve deploy. Nenhuma troca
de credenciais ou contorno de permissão foi realizada.

- `docs/CORRECOES_UX_CONFIRMADAS_2026-09-20.md`
- `docs/REFORMULACAO_UX_PAINEL_2026-09.md`
- `docs/STATUS_ATUAL.md`
- `src/app/(admin)/admin-presentation.css`
- `src/app/(admin)/agenda/agenda-board.tsx`
- `src/app/(admin)/agenda/page.tsx`
- `src/app/(admin)/assinatura/page.tsx`
- `src/app/(admin)/clientes/client-form.tsx`
- `src/app/(admin)/clientes/client-history-states.test.tsx`
- `src/app/(admin)/clientes/clients-crm.tsx`
- `src/app/(admin)/configuracoes/closures-manager.tsx`
- `src/app/(admin)/configuracoes/salon-settings-form.tsx`
- `src/app/(admin)/configuracoes/team-hours-manager.tsx`
- `src/app/(admin)/financeiro/expense-manager.tsx`
- `src/app/(admin)/financeiro/page.tsx`
- `src/app/(admin)/form-dialog.tsx`
- `src/app/(admin)/form-wizard.tsx`
- `src/app/(admin)/hoje/hoje-view.tsx`
- `src/app/(admin)/loading.tsx`
- `src/app/(admin)/marketing/page.tsx`
- `src/app/(admin)/mobile-nav.tsx`
- `src/app/(admin)/pacotes/package-form.tsx`
- `src/app/(admin)/pacotes/pacotes-view.tsx`
- `src/app/(admin)/pacotes/plan-form.tsx`
- `src/app/(admin)/portfolio/delete-button.tsx`
- `src/app/(admin)/portfolio/page.tsx`
- `src/app/(admin)/portfolio/portfolio-form.tsx`
- `src/app/(admin)/produtos/product-form.tsx`
- `src/app/(admin)/profissionais/page.tsx`
- `src/app/(admin)/profissionais/professional-form.tsx`
- `src/app/(admin)/profissionais/working-hours-form.tsx`
- `src/app/(admin)/relatorios/page.tsx`
- `src/app/(admin)/servicos/service-form.tsx`
- `src/app/(admin)/task-form.tsx`
- `src/app/(admin)/use-form-operation.ts`
- `src/app/(admin)/ux-confirmed-fixes.test.tsx`
- `src/components/notification-list.tsx`
