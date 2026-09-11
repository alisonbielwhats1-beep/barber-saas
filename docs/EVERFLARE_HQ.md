# Everflare HQ — fundação interna
Data: 10/09/2026. Base auditada: origin/master 16ac54c. Branch codex/everflare-hq.
Esta entrega não representa publicação em produção.

Atualização posterior à proposta: o responsável autorizou usar o projeto
existente como destino. A migration 020 foi aplicada e verificada; testes
continuam no CI descartável. O registro de execução em HQ_RELEASE_2026-09-10.md
substitui os requisitos de staging e os estados planejados abaixo.

## Auditoria antes da implementação
Next.js 15.5, React 18, TypeScript, Prisma 5, NextAuth Credentials/JWT,
Supabase PostgreSQL com app_runtime sem BYPASSRLS e transações com GUCs locais.
User é global; Membership e ClientProfile pertencem ao produto vendido.
getPlatformAdminContext consulta o papel persistido e permite o bootstrap já
existente. As sessões de clientes do Booksite são distintas do NextAuth.
Reutilizar autenticação, componentes Button/Input/Dialog, tipografia Inter,
lucide-react, Vitest, Playwright e o job schema-smoke. Layout próprio em /hq.

## Conflitos e limites
- ClientProfile não representa o cliente B2B do Everflare.
- Payment é recebimento de atendimento. PlatformInvoice pertence ao billing
  legado 011, ainda desativado. O HQ não lê nem escreve nessas tabelas.
- Nenhuma assinatura HQ altera acesso/plano de Salon automaticamente.
- A grafia existente Everflair é preservada no produto. A área solicitada
  recebe o nome Everflare HQ.
- O worktree original contém mudanças em layout/scrollcraft de outra tarefa.
  A implementação usa um worktree isolado, baseado no master atualizado.
- As migrations 018/019 já estão aplicadas segundo STATUS_ATUAL; não reaplicar.
- Banco local indisponível; migrations e RLS serão testadas no CI descartável.
  Staging deve ser identificado antes de habilitar HQ fora do CI.

## Arquitetura proposta
/hq tem layout privado, sidebar responsiva e autorização por operação.
Componentes chamam Server Actions; estas validam sessão e delegam aos serviços.
Serviços transacionais e repositories fazem consultas parametrizadas e
validação de domínio. O adaptador de identidade de agentes será futuro; nenhum
SDK, chave, mensagem automática ou gateway é incluído.
HQ_ENABLED controla a ativação depois da migration; não habilita billing 011.

## Schema proposto
Todas as tabelas novas usam prefixo hq_, UUID, timestamps, FK RESTRICT,
índices de busca operacional e RLS ENABLE/FORCE. Valores monetários em centavos.
- accounts: identidade e contatos compartilhados, responsável, risco/prioridade.
- leads/customers: extensões 1:1 da conta; conversão mantém conta e lead original.
- opportunities: negociação e etapa por conta, datas e valor potencial.
- subscriptions: plano, valor/desconto, periodicidade, trial, próxima cobrança.
- payments: assinatura/cliente, competência, vencimento, estado, recebimento.
- activities: trilha append-only por conta e ator, com referências e metadados.
- followups: tarefas por conta, estado e agendamento.
- support_tickets: cliente, categoria, prioridade, resolução e responsável.
- bugs / bug_customers: problema compartilhado e clientes afetados.
- feature_requests / feature_request_customers: solicitação e interessados,
  unicidade por título normalizado e revisão explícita antes de criar semelhante.
- feedbacks: cliente, tipo, atividade e conversão idempotente para item existente
  ou novo ticket/bug/feature.
CMM e indicadores são projeções desses mesmos registros.

## Interface
Base cinza frio #f4f6f8, superfície #ffffff, texto #172b34, ação #126949,
alerta #a65f12 e bordas #dce3e7. Inter para operação; números tabulares.
Atenção necessária é a área de destaque, com pendências reais e links diretos.
Sem métricas fictícias em estados vazios. Formulários acessíveis e navegação
por teclado; mudança de etapa por seletor também disponível em telas touch.

## Migração e recuperação
020 é aditiva e isolada. Preflight identifica banco/usuário e dependências,
CI faz backup/restauração sintética antes de aplicar, verifica preservação,
reaplica e exercita RLS com role NOBYPASSRLS. Rollback: desabilitar HQ_ENABLED,
voltar código anterior e preservar integralmente as tabelas para roll-forward.
Produção exige preflight, backup, staging validado e aprovação de promoção.
Não executar db push ou seed produtivos.
