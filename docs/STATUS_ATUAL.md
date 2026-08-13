# Status atual canônico — Salon SaaS

Atualizado em **13/08/2026** após o PR
[#48](https://github.com/alisonbielwhats1-beep/barber-saas/pull/48).
Este arquivo substitui os status históricos quando houver contradição.

## Identificação da versão

- Repositório: `alisonbielwhats1-beep/barber-saas`
- Branch produtiva: `master`
- Commit funcional da aplicação: `bc4aab8451548d5ac1fc3b121c73591e1c099ce0`
- Vercel: projeto `salon-saas`
- Deploy do commit: `dpl_AoMGQXkw1ZbfZchSr4qb2gjUakuS`, estado `READY`
- URL oficial: [salon-saas-ruby.vercel.app](https://salon-saas-ruby.vercel.app)
- Região das Functions: `gru1`
- Banco/Storage: Supabase do projeto de barbearia
- Erros de runtime logo após o deploy: nenhum encontrado

## O que está em Production

### Estabelecimento

- dashboard, agenda dia/semana/mês/lista, clientes, profissionais e serviços;
- financeiro, despesas, relatórios, produtos, estoque, pacotes e portfólio;
- configurações do perfil, logo e capa do estabelecimento;
- notificações internas e lembretes pelo cron;
- permissões por papel, com financeiro bloqueado para profissional;
- seletor de tenant para usuários com múltiplos vínculos.

### Cliente

- vitrine pública por `salonSlug`;
- seleção de múltiplos serviços, profissional, data e horário;
- seleção automática quando somente um profissional realiza todos os serviços;
- CTA de agendamento fixo na viewport e revisão final antes da confirmação;
- criação idempotente, histórico, reagendamento e cancelamento;
- fluxo explícito mobile e barra inferior com safe area;
- notificações internas e lista de espera vinculada ao horário;
- próxima reserva destacada, com data relativa, duração e endereço;
- cor de marca aplicada em toda a experiência pública;
- fotos dos serviços usadas na vitrine e como capa das categorias;
- catálogo de produtos e portfólio público.

### Confiabilidade da agenda

- timezone IANA por estabelecimento e servidor como fonte de verdade;
- `timestamptz` para instantes e intervalo `[início, fim)`;
- transação, advisory lock, idempotency key e proteção de conflito no banco;
- múltiplos serviços com snapshots de duração/preço;
- reagendamento atômico mantendo o mesmo agendamento;
- cancelamento sem delete, com ator, motivo, evento e liberação do horário;
- histórico imutável de eventos e outbox idempotente de notificações;
- polling seguro como fallback; Supabase Realtime ainda não é a fonte principal.

### Administração global

- `PlatformRole.SUPER_ADMIN` separado dos papéis de cada tenant;
- login padrão do SUPER_ADMIN redireciona para `/plataforma`;
- visão geral e fila de solicitações de estabelecimentos;
- aprovação como FREE/PRO, alteração de plano, suspensão e reativação;
- suspensão preserva todos os dados;
- decisões gravadas em `SalonAccessEvent`;
- e-mail do administrador principal configurado em variável sensível da Vercel;
- a promoção persistente ocorre no primeiro acesso autenticado à plataforma.

## Banco, RLS e migrations

### Estado conhecido

- O runtime usa a role `app_runtime`, sem `BYPASSRLS`.
- RLS e GUCs (`app.current_salon`, `app.current_user_id` e token de convite)
  reforçam o isolamento no banco.
- O código não deve usar Prisma cru em operação tenant-scoped; use os helpers
  de `src/lib/prisma-tenant.ts`.
- As três migrations Prisma de convites foram reconciliadas/aplicadas na Fase 1.
- A migration manual `008_fase2_appointment_reliability` foi aplicada e
  verificada em Production durante o rollout da Fase 2.
- As estruturas de `009_waitlist_reliability` e
  `010_platform_access_approval` pertencem às versões produtivas atuais.
  Como são SQL manual, confirme objetos e policies com consultas somente
  leitura antes de qualquer migration futura; não as reaplique cegamente.

### Não aplicado

- `011_platform_billing.sql` **não foi aplicado em Production**.
- `PLATFORM_BILLING_ENABLED` permanece ausente ou `false`.
- A interface de cobranças do SaaS fica inacessível e as Server Actions falham
  fechadas enquanto a flag estiver desligada.
- Preflight e rollback não destrutivo estão versionados junto da migration.

### Proibições

- não executar `prisma db push`, seed, reset ou `migrate dev` em Production;
- não usar Production para descobrir se uma migration “funciona”;
- não marcar migration como aplicada sem comparar o schema real;
- não remover snapshots, eventos, invoices ou agendamentos cancelados;
- não trocar `DATABASE_URL` para a role `postgres` com `BYPASSRLS`.

## Ambientes

- Desenvolvimento: PostgreSQL local com dados fictícios.
- CI: PostgreSQL 16 efêmero; executa lint, typecheck, unitários, integração,
  concorrência, build e schema smoke-test.
- Preview/staging: a arquitetura está documentada, mas um segundo Supabase
  inequivocamente identificado ainda é necessário para homologar migrations.
- Production: Vercel + Supabase atuais; migrations produtivas não são
  automatizadas pelo repositório.

## Integrações e flags

- Upstash/KV: configurado para rate limiting distribuído.
- Supabase Storage: bucket público de assets usado para imagens permitidas.
- Vercel Cron: `/api/cron/reminders`, protegido por `CRON_SECRET`.
- Resend/e-mail: infraestrutura existe, mas convites reais permanecem
  desativados até configurar e validar `RESEND_API_KEY`, `EMAIL_FROM` e
  `EMAIL_INVITES_ENABLED=true` primeiro fora de Production.
- WhatsApp: somente atalho manual; nenhuma integração paga automática.
- Billing automático/Stripe: não implementado nem autorizado.

## Melhoria da jornada do cliente implantada

- O PR #44 foi integrado a `master` e implantado em Production.
- A seleção de serviços não exige mais rolagem até o fim da lista para avançar.
- O único profissional compatível é selecionado automaticamente; quando há
  mais opções, a escolha continua explícita.
- A confirmação ganhou uma revisão final com serviço, profissional, data,
  duração, total, endereço e política de cancelamento.
- A próxima reserva tem prioridade visual sobre histórico e filas de espera.
- Categorias aceitam nomes livres e usam a primeira foto de serviço disponível
  como capa, evitando migration ou alteração de banco.
- Deploy funcional: `dpl_DheyfzeD79yKhaKjNNfCuzVjpaYy`, estado `READY`.
- Nenhum banco, migration, variável remota ou dado do Supabase foi alterado.

## Marketing e reativação implantados

- O PR #48 foi integrado a `master` e implantado em Production.
- “Lembrete de sumidos” existe na página de Marketing e continua usando o
  WhatsApp manual, sem disparo pago ou automático.
- O dono configura entre 15 e 365 dias para um cliente ser considerado sumido;
  o padrão seguro permanece 60 dias.
- A regra é tenant-scoped e vale de forma consistente em Marketing, Clientes,
  Dashboard e Relatórios.
- A configuração é persistida na trilha append-only `AuditLog`, sem migration
  ou alteração de schema em Production.
- Campanhas podem personalizar nome, cupom, dias sem visita, serviço favorito,
  link de agendamento e link de avaliação do Google.
- A página prioriza reativação semanal, avaliações e indicações, com uma
  oportunidade de retorno estimada a partir do ticket real da base.
- Deploy funcional: `dpl_AoMGQXkw1ZbfZchSr4qb2gjUakuS`, estado `READY`.
- Home e vitrine pública responderam `200`; `/marketing` sem sessão respondeu
  `307` para login; não houve erro nos logs pós-deploy verificados.

## Evidências da entrega atual

- `npm run lint`: passou.
- `npx tsc --noEmit --incremental false`: passou.
- `npm test`: 61 arquivos e 297 testes passaram.
- `npm run build`: passou com Next.js 15.5.22.
- CI, integração, build e `schema-smoke` do PR #48: passaram.
- Inspeção visual com 24 serviços: CTA fixo no limite da viewport, seleção
  automática e revisão final confirmadas, sem erro de console.
- Produção após deploy: home, vitrine pública e agendamento responderam `200`;
  a Vercel não registrou erros no intervalo verificado.

## Pendências reais e priorizadas

1. Confirmar manualmente o primeiro login do administrador principal e a
   promoção para `SUPER_ADMIN`; nenhuma senha foi acessada pelo agente.
2. Criar/identificar Supabase de homologação separado antes da migration `011`.
3. Validar a migration `011`, RLS, rollback e cobranças manuais em staging;
   só depois decidir se ativa em Production.
4. Ativar convites por e-mail via Resend somente após teste completo em Preview.
5. Adicionar Playwright para jornadas E2E quando houver banco de staging seguro.
6. Ensaiar backup nativo/restore do Supabase antes de clientes reais.
7. Rotacionar/remover qualquer credencial de demonstração conhecida e nunca
   documentar senhas no repositório público.
8. Realtime filtrado por tenant, múltiplas unidades e pagamento online continuam
   fora do escopo atual.

## Próximo passo recomendado

Não refazer auditoria geral. Começar por uma verificação curta do repositório e
escolher apenas uma frente:

- **Operação imediata:** validar login SUPER_ADMIN e onboarding de um tenant;
- **Infraestrutura:** criar staging Supabase e ensaiar a migration `011`;
- **Qualidade:** adicionar E2E dos fluxos críticos em Preview isolado.

## Prompt curto para outra conversa

> Trabalhe no repositório `alisonbielwhats1-beep/barber-saas`. Leia primeiro
> `AGENTS.md`, `docs/STATUS_ATUAL.md`, `docs/AMBIENTES.md` e
> `docs/DECISOES_PRODUTO.md`. Não refaça auditoria completa e não altere
> Production. Confirme branch limpa, CI e o escopo escolhido. A versão
> funcional implantada é o commit `bc4aab8`; a migration
> `011_platform_billing` não foi
> aplicada e a flag de billing está desligada. Preserve RLS, histórico e
> isolamento multi-tenant. Proponha o próximo passo antes de qualquer migration.
