# Suporte assistido — escopo de 11/09/2026

## Auditoria e arquitetura
Reutilizar withHq/NextAuth SUPER_ADMIN, RLS, hq_agent_runs, orçamento global,
timeline append-only e serviços de tickets/bugs/features existentes. Não há
WhatsApp nem identidade externa nesta fase: o administrador seleciona o cliente.
Contexto restrito à conta escolhida, com contagens de tickets e atividades;
não enviar contatos nem textos livres do histórico para a IA.

Base inicial versionada no código, com fontes e data de revisão técnica,
consultável em /hq/agents/knowledge. Regras comerciais indefinidas encaminham
para humano. Alterações da base seguem revisão de código; editor de artigos e
busca semântica são evoluções futuras. Nenhum embedding ou serviço adicional.

Fluxo /hq/agents/support: cliente -> dúvida -> artigos recuperados -> uma
chamada SDK/Luna -> rascunho persistente -> edição e decisão administrativa.
Respostas são estruturadas e validadas; nenhuma ferramenta de escrita para IA.
Sem base aplicável ou fonte inválida, exigir atendimento humano. A aprovação
permite registrar resposta revisada, ticket ou associação a bug/feature existente.
Criação de novos bugs/features continua no módulo Produto com revisão de similares.
Nenhuma aprovação envia mensagem ou marca ticket resolvido automaticamente.

## Persistência e conflitos
Sem migration: hq_agent_runs.snapshot recebe kind=support, customerId e versão
dos artigos. A mesma trava e soma de consumo cobrem Chefe e Suporte. Reserva
idempotente compara contexto da conta além de ator/pergunta. Histórico Chefe
exclui execuções de Suporte; acesso direto continua restrito ao administrador.
Decisão final é atividade imutável ligada à conta, com entityType=support_review
e entityId=run.id. Lock da execução serializa decisões/replays e criação do
encaminhamento na mesma transação. Revalidar cliente/conta a cada aprovação.
Rascunhos não são mensagens recebidas nem conversas WhatsApp.

## Validação e publicação
Testes de transporte SDK falso, isolamento, fontes, replay, concorrência e
aprovação em PostgreSQL descartável. Lint, TypeScript, testes, build e CI/Preview.
HQ_SUPPORT_ENABLED permanece false por padrão até publicação autorizada.
Consumo usa o mesmo teto HQ_CHIEF_MONTHLY_USD; não criar orçamento extra.
Rollback: desativar Suporte e voltar código; preservar execuções e atividades.
