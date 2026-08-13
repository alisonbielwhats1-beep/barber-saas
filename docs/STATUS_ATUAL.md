# Status atual canônico — Salon SaaS

Atualizado em **13/08/2026** após o PR
[#48](https://github.com/alisonbielwhats1-beep/barber-saas/pull/48).
Este arquivo substitui os status históricos quando houver contradição.

> A seção “Candidata wave1 de maturidade comercial” descreve trabalho local
> posterior ao PR #48. Ela **não está em Production**: CI remoto, Preview e
> deploy continuam pendentes até haver evidência verificável.

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

## Candidata wave1 de maturidade comercial — ainda não implantada

Estado local da branch `codex/commercial-maturity-wave1`, revisado por ondas de
implementação e crítica independente:

### Jornada e componentes compartilhados

- disponibilidade diferencia dia realmente vazio (`200` com `slots=[]`) de
  timeout, rede, JSON/contrato inválido, `429` e erro de servidor;
- seleção restaurada só volta para a mesma combinação de salão, serviços,
  profissional e data; respostas fora de ordem são descartadas e o CTA fica
  bloqueado até o horário estar confirmado na grade atual;
- retry respeita `Retry-After` em segundos ou HTTP-date, exibe contagem,
  preserva escolhas e consulta a combinação atual após troca de data;
- Toast possui regiões vivas separadas por severidade, anúncio único, fila,
  limpeza de timers, pausa em hover/foco e continuidade de foco ao fechar;
- Dialog compartilhado nomeia o fechamento e usa alvo mínimo de 44 px;
- Command Palette e o modal mobile “Mais” usam coordenação explícita: somente
  um modal/focus trap permanece aberto, inclusive via `Ctrl/Cmd+K`, e Escape
  devolve o foco a um gatilho conectado.

### Segurança pública e isolamento

- `withApprovedSalon` e `withSalonBySlug` validam `APPROVED` sob lock
  compartilhado durante todo o callback, serializando suspensão concorrente;
- login do cliente valida schema/tamanho/72 bytes antes de headers, rate
  limiting, lookup ou bcrypt, e ganhou bucket global por IP contra rotação de
  slugs sem remover buckets por salão e conta;
- cadastro, agendamento visitante e lista de espera usam a mesma validação de
  telefone BR: formatos nacional, `55` e `+55`, celular/fixo, DDD e prefixo;
  excesso é rejeitado sem truncar ou transformar silenciosamente outro número;
- cron consulta apenas salões aprovados e revalida/bloqueia cada tenant durante
  a geração idempotente de lembretes;
- rotas públicas de disponibilidade, agendamento e fila falham de forma
  uniforme para estabelecimento inexistente ou não aprovado.

### Agenda, comanda, estoque e fila

- mutações operacionais usam ordem canônica de locks `appointment →
  professional → product`, com ids ordenados dentro de cada grupo;
- reserva de produtos no agendamento público é atômica com a criação e com o
  fingerprint idempotente; preço/quantidade são snapshots do servidor;
- comanda reconcilia reserva anterior com a quantidade final: conserva o preço
  das unidades reservadas, usa preço atual somente nas adicionais, debita ou
  devolve apenas o delta e registra `Payment` e auditorias na mesma transação;
- fechamento da comanda é idempotente, impede double debit/double payment,
  bloqueia desconto da recepção e gera recibo interno/imprimível a partir do
  pagamento persistido;
- ajustes manuais de estoque são tenant-scoped, bloqueiam estoque negativo e
  registram saldo anterior/novo e motivo em `AuditLog`;
- cancelamento restaura cada reserva no máximo uma vez; cancelamento pela
  equipe encerra todas as entradas ativas daquela fila sem realocação;
- `IN_PROGRESS` e `COMPLETED`, assim como a abertura da comanda, só são aceitos
  depois do início contratado; a UI deriva as ações da mesma regra temporal.

### Testes e gates da candidata

- testes DOM cobrem concorrência da disponibilidade, cooldowns sucessivos,
  troca de consulta durante `429`, modais mobile/palette, teclado e retorno de
  foco;
- testes PostgreSQL descartáveis cobrem concorrência de agenda, comanda/estoque
  e o lock de aprovação versus suspensão; o último identifica o backend por
  `application_name` e prova bloqueio com `pg_stat_activity` e
  `pg_blocking_pids`;
- `schema-smoke` está configurado para executar essas três famílias pelo script
  `test:appointment-integration`;
- evidência local final da candidata: lint e TypeScript passaram; `npm test`
  passou com 70 arquivos e 446 testes; o build completo do Next.js 15.5.22
  passou e gerou 41 páginas;
- esta máquina não possui PostgreSQL/Docker nem staging seguro; portanto a
  integração PostgreSQL, browser autenticado, Preview e CI remoto ainda
  precisam ser comprovados fora desta sessão.

### Limitações deliberadamente não resolvidas

- `AppointmentProduct` ainda não possui `salonId`; a aplicação valida e trava o
  tenant, mas a defesa estrutural ideal exige migration tenant-aware aditiva;
- o recibo preserva pagamento, preço e quantidade, porém nome do produto e
  moeda ainda vêm do catálogo/configuração atuais, sem snapshot fiscal;
- não houve migration, alteração de Supabase, CI remoto, Preview ou deploy para
  esta wave.

## Evidências da entrega implantada no PR #48

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

1. Rodar CI completo da candidata wave1, incluindo `schema-smoke` e integrações
   PostgreSQL; depois validar Preview seguro e somente então
   decidir merge/deploy.
2. Criar a migration tenant-aware de `AppointmentProduct`, com preflight,
   backfill, constraints compostas, RLS e rollback, apenas após staging e nova
   autorização; incluir snapshots persistentes de nome do produto e moeda em
   uma decisão de schema própria.
3. Confirmar manualmente o primeiro login do administrador principal e a
   promoção para `SUPER_ADMIN`; nenhuma senha foi acessada pelo agente.
4. Criar/identificar Supabase de homologação separado antes da migration `011`.
5. Validar a migration `011`, RLS, rollback e cobranças manuais em staging;
   só depois decidir se ativa em Production.
6. Ativar convites por e-mail via Resend somente após teste completo em Preview.
7. Adicionar Playwright para jornadas E2E quando houver banco de staging seguro.
8. Ensaiar backup nativo/restore do Supabase antes de clientes reais.
9. Rotacionar/remover qualquer credencial de demonstração conhecida e nunca
   documentar senhas no repositório público.
10. Realtime filtrado por tenant, múltiplas unidades e pagamento online continuam
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
