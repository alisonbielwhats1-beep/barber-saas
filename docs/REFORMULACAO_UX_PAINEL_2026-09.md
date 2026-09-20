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
- Produtos: nome, preço e estoque priorizados; foto e fornecedor sob demanda.
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
A suíte local passou com 208 arquivos / 1.113 testes, incluindo preservação do
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

