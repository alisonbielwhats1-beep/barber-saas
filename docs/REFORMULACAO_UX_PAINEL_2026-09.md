# Reformulação visual do painel — setembro de 2026

## Escopo autorizado

O pedido inicial limitava-se à Agenda. O responsável aprovou a implementação,
substituiu entregas em microetapas por entregas completas por aba e depois
confirmou explicitamente a ampliação para todas as abas do painel mostradas na
referência: Hoje, Agenda, Clientes, Serviços, Produtos, Profissionais, Financeiro,
Relatórios e Configurações. A referência orienta estrutura e acabamento; a marca,
os tokens dos temas e as regras existentes permanecem. Não inclui copiar fotos,
criar avatares ou mudar o aplicativo público e a administração da plataforma.

Branch `codex/agenda-ux-mobile`, baseada em `87b8ffc`, PR #111.
As alterações preexistentes no checkout original foram preservadas.
`docs/UX_MOBILE_PLAN.md` não existe nesta base; foram usados o roteiro fornecido,
`STATUS_ATUAL.md`, `MOBILE_GUIADO_2026-09-14.md` e as decisões atuais.

## Implementação

- Agenda: controles compactos, filtros com contador e limpeza, avisos recolhíveis
  com período explícito. Grade percorre toda a equipe, sem limite de dois
  profissionais; rolagem interna e larguras adaptadas ao celular.
- Novo agendamento: Cliente → Serviços → Revisão, busca única de clientes,
  cadastro sem persistência antecipada, contexto do horário preservado e editável.
  Rodapé fixo, estimativa identificada, quantidades/repetições, notas e recorrência
  acessíveis sob demanda. Serviços incompatíveis não são apagados silenciosamente.
- Múltiplos profissionais: transição preserva cliente, data e serviços. Cada item
  mantém profissional e horário próprios; busca, sequência automática e início
  explícito existentes permanecem. Recorrência e notas não são transferidas a um
  contrato que não as suporta: a interface informa essa limitação previamente.
- Descarte: confirmação isolada, com retorno ao rascunho. Edição de reserva tem
  revisão antes/depois antes da gravação. Reagendar usa a ação de edição existente.
  Cancelamento preserva motivo, fila, versão, histórico e autorização existentes.
- Hoje: próximo atendimento destacado, a partir dos dados já carregados.
- Clientes: busca e formulário padronizados; informações complementares agrupadas.
- Serviços: dados principais antes de imagens/variantes/recursos, todos os campos
  originais continuam no formulário. Valores variáveis permanecem identificados.
- Produtos: lista compacta com nome, preço e estoque; controles completos de movimentação e edição nos detalhes expansíveis. Foto e fornecedor sob demanda no cadastro; ícone neutro quando não há imagem.
- Profissionais: busca com contagem, cadastro com perfil e dados de trabalho.
- Financeiro: posição do período antes da operação de recebimentos; valores e
  consultas inalterados. Relatórios: indicadores antes de oportunidades e grids
  adaptados ao celular. Configurações: grupos compactos pesquisáveis.
- Componentes compartilhados de apresentação: cabeçalhos, campos, rodapés e
  seções expansíveis com valores preservados e abertura automática por invalidez.
  CSS restrito ao painel e componentes explicitamente marcados.

## Preservação funcional

Sem alteração de Server Actions, APIs, Prisma, RLS, autenticação, permissões,
serviços de domínio, flags, cobranças ou dados. As cotações multiprofissionais
continuam calculadas no servidor e a confirmação continua transacional.
Exceções de jornada/pausa/bloqueio/encaixe e idempotência seguem os contratos atuais.
Edição reserva o novo horário imediatamente e a recusa posterior do cliente não
restaura a origem. Não há edição ou cancelamento coletivo de visita novo.

## Validação e limites

Os resultados específicos do commit final e CI serão registrados no PR.
A suíte local passou com 209 arquivos / 1.115 testes, incluindo preservação do
rascunho, seleção do 13º profissional, horários simultâneos, confirmação pela cotação do servidor, idempotência, exceções e campos recolhidos.
Lint, TypeScript e build aprovados; ajustes posteriores de CSS exigem conferência
responsiva correspondente. A matriz visual local usa 320, 390, 768 e 1280 px.

A prévia em `.demo/agenda-preview/` é ignorada pelo Git, usa componentes reais com
ações substituídas e dados fictícios. Não grava dados nem substitui jornadas
integradas. A confirmação multiprofissional nela é indisponível porque depende
de cotação do servidor. Não declarar a prévia como homologação de persistência.

Sem merge ou publicação em produção nesta entrega. CI e Preview devem passar
antes da revisão final; promoção depende de autorização. Rollback por reversão
dos commits de interface, sem operação no banco.

## Complemento — estrutura de Clientes

O responsável confirmou manter clientes sem foto nesta entrega; não há campo
persistido para avatar no cadastro atual. Não foi reaproveitada foto de prontuário.
A lista passou a exibir nome, telefone e visitas; filtros existentes em chips,
atalho flutuante de cadastro no celular e detalhes em Resumo/Histórico/Preferências.
Clientes excluídos permanecem uma condição de visibilidade da lista, sem serem
renomeados como contas inativas ou perderem acesso. Recuperação/importação seguem
em Mais opções, com as mesmas permissões e ações existentes.
## Ajuste explícito à estrutura da referência

Após a revisão do responsável, Clientes, Serviços, Produtos e Profissionais
passam diretamente do título para busca/filtros/lista, sem KPIs superiores em
nenhuma largura. Indicadores existentes ficam recolhidos abaixo da lista.
Cadastro pelo botão flutuante no celular; categorias de serviços sempre visíveis.
Profissionais abre o perfil a partir da linha, preservando edição, convites,
comissão, jornada e ativação. Produtos usa linhas com estoque e detalhes expansíveis.

Cliente usa Essencial → Complementar; Produto usa Básico → Venda → Estoque.
Serviço usa Principal → Avançado: o contrato atual não vincula profissionais na
criação; esse vínculo permanece no cadastro do profissional. Não foram inventados
filtros de cliente ativo/inativo, que não existem no contrato atual. Campos e
validações existentes permanecem. FormWizard mantém os campos montados, valida
cada etapa e somente grava no fim; dois testes cobrem retenção e envio completo.


## Revisão de estrutura — 20/09/2026

A revisão remove a faixa de marca/plano das páginas internas no mobile; marca fica
em Hoje e plano/tema ficam acessíveis em Mais. Agenda mostra mês, semana de datas
e Dia/Semana/Lista. Avisos passam para um ícone com painel, sem faixa ocupando a
grade. Visualização mensal, cores e dia inteiro continuam acessíveis nos filtros.

Clientes remove o contêiner de card da lista. Segmentos VIP/aniversariantes/
sumidos/recorrentes e indicadores/retornos ficam em Filtros, com seleção ativa
visível ao retornar. Excluídos não são renomeados como inativos. Produtos mostra
categorias reais; reposição/falta ficam no painel de filtros. Serviços e equipe
usam linhas sem moldura externa. Equipe mantém busca visível abaixo do título; indicadores continuam no painel.

Financeiro prioriza Recebido/A receber, gráfico e distribuição dos pagamentos.
Operações de recebimento, despesas e composição permanecem no detalhamento.
Relatórios mostra faturamento/agendamentos/ticket/novos clientes e acessos aos
relatórios específicos. Seleção usa os períodos realmente suportados pelas
consultas atuais: não simula meses de calendário para resultados de 30 dias.

Perfil profissional usa Resumo/Serviços/Agenda, foto real de avatarUrl e edição
com o controle de imagem existente. Não insere retratos fictícios nem altera o
armazenamento. Cadastro de foto de cliente continua fora do escopo. Cliente
prioriza próximo agendamento e histórico; informações/fidelidade permanecem no
resumo expandido, exclusão/restauração em Preferências. Novo ag. abre a Agenda
com um cliente visível do tenant pré-selecionado, ainda editável e sem escrita
até confirmação. Cadastro em duas etapas conserva todos os campos existentes.

Os testes de navegação acompanham os novos acessos. A impressão de relatórios
expande o detalhamento e restaura o estado depois de imprimir. A revisão é
frontend: não modifica domínio, APIs, Prisma, permissões ou dados produtivos.

A barra mobile mantém Hoje, Agenda, Clientes e Mais, conforme acesso do papel.
Alertas continuam em Mais, com contador de não lidos no botão. O atalho de
Agenda no perfil profissional já abre o filtro desse profissional visível.
