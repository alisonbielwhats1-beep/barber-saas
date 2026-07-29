# Auditoria geral e plano de evolução

Data de referência: 29/07/2026

Repositório: `alisonbielwhats1-beep/barber-saas`

Produção: `https://salon-saas-ruby.vercel.app`

## 1. Veredito executivo

A revisão de segurança da Fase 1 foi incorporada ao `master` pelo
[PR #1](https://github.com/alisonbielwhats1-beep/barber-saas/pull/1) e teve
deploy Vercel bem-sucedido. O commit seguinte, que reduziu a pressão do
dashboard sobre o pool de conexões, também foi publicado pelo
[PR #2](https://github.com/alisonbielwhats1-beep/barber-saas/pull/2).

Validações externas, sem alterar dados:

- `/api/cron/reminders` sem segredo respondeu `401 Unauthorized`;
- `/api/client/appointments` sem sessão respondeu `401 UNAUTHENTICATED`;
- `/book/luna-hair/minhas` sem sessão redirecionou para o login;
- `/convite/<token-inexistente>` exibiu mensagem genérica de convite inválido;
- a produção está servindo um build Next.js 15, compatível com o código atual do
  `master`.

Conclusão: a Fase 1 está online, mas o produto ainda não está pronto para uma
expansão comercial sem acompanhamento. Segurança imediata melhorou; onboarding
de equipe, rate limiting distribuído, upload, RLS amplo, migrations, testes com
PostgreSQL e operação de produção ainda exigem trabalho.

O preview Vercel do PR #3 falhou. Uma branch posterior contendo somente estes
arquivos de documentação também recebeu falha imediata no preview, enquanto o
deploy do `master` permaneceu saudável. Isso aponta para um problema sistêmico
na configuração/pipeline de previews; não é evidência de falha funcional da
produção nem, isoladamente, de defeito no código do PR #3.

O checkout `D:\Projetos\barber-saas` estava na branch
`fix/fase-1-seguranca`, inicialmente no commit `6a30cb3`, e ficou atrás do
remoto. Ele não deve ser usado como evidência do que está publicado. A fonte de
verdade para produção é `origin/master`.

## 2. Situação da Fase 1

### Confirmado como implementado

- API pública de agendamento não aceita `clientId` como prova de identidade.
- Histórico e cancelamento usam sessão de cliente e escopo de salão.
- Cron falha fechado quando o segredo está ausente ou incorreto.
- Comparação do segredo verifica tamanho antes de `timingSafeEqual`.
- Senha fixa `trocar-agora` foi removida dos fluxos de produção.
- Convites usam token aleatório, SHA-256 no banco, expiração e consumo único.
- Aceite de conta existente exige a sessão do próprio destinatário.
- Consumo, Membership e ativação de Professional ocorrem em transação.
- `callbackUrl` do login é normalizado antes de `router.push`.
- Next.js foi atualizado para 15.5.22.
- A tabela `UserInvite` existe em produção, pois a rota pública a consulta.

### Riscos e limitações restantes

- Conta nova continua bloqueada até existir verificação real de e-mail. Isso é
  seguro, porém impede onboarding autônomo de novos profissionais.
- O [PR #3](https://github.com/alisonbielwhats1-beep/barber-saas/pull/3)
  implementa convites por e-mail com Resend, mas seu preview Vercel está com
  status de falha e a migration declaradamente não foi aplicada em produção.
- No `master`, um convite para profissional existente cria antecipadamente um
  `Professional` inativo. Se o convite expirar ou for abandonado, esse registro
  pode bloquear um convite profissional em outro salão por causa do `userId`
  globalmente único.
- O rate limiter cai para um `Map` local quando Upstash está ausente ou falha.
  Em Vercel serverless isso não é proteção distribuída.
- Upload valida sessão global, mas não Membership/salão; o bucket é público e o
  tipo real do arquivo não é inspecionado.
- RLS está aplicada à tabela de convites, não ao conjunto inteiro de tabelas do
  SaaS. O isolamento principal ainda depende dos filtros `salonId` no código.
- Os testes de segurança são majoritariamente baseados em mocks. Ainda faltam
  testes de integração reais com PostgreSQL para concorrência, constraints,
  transações e isolamento.

## 3. O que existe hoje

O produto real usa Next.js App Router, NextAuth, Prisma e PostgreSQL no
Supabase. Os dez prompts originais pressupõem Flutter + Supabase Auth/RLS; essa
premissa não corresponde ao repositório e deve ser substituída.

Módulos existentes:

- landing, login, cadastro e onboarding;
- painel multi-tenant por `Membership` e `salonId`;
- dashboard, agenda, clientes, profissionais e serviços;
- financeiro, despesas, produtos, estoque e relatórios;
- pacotes e assinaturas oferecidos pelo salão aos clientes;
- CRM, marketing por WhatsApp, portfolio e página de compartilhamento;
- agendamento público, conta do cliente, histórico e cancelamento;
- cron de lembretes, upload e convites de equipe.

Lacunas estruturais:

- cada `Appointment` aceita apenas um `serviceId`;
- não existe lista de espera;
- não existe billing real do próprio SaaS;
- não existe modelo de unidades/filiais;
- não existe audit log geral, feature flag estruturada ou analytics de produto;
- não há observabilidade completa, SLO, alerta e restore testado;
- documentação de roadmap contém itens concluídos e pendentes misturados.

Há ainda uma promessa pública de “30% de desconto” na página do salão sem
regra correspondente no backend. A promoção deve ser implementada de verdade,
configurada por salão ou removida para não quebrar confiança.

## 4. Avaliação dos dez prompts

| Ordem | Prompt | Estado real | Prioridade |
|---|---|---|---|
| 1 | Produto | Parcial: bom núcleo, agenda e CRM; faltam multi-serviço, waitlist, validação com usuários e métricas | P1 |
| 2 | Arquitetura | Parcial: monólito modular adequado; isolamento ainda depende muito do código e falta operação formal | P0/P1 |
| 3 | Banco | Parcial: schema amplo; migrations, RLS global, audit log e testes PostgreSQL são lacunas | P0 |
| 4 | Backend | Parcial: controles críticos existem; upload, rate limit, idempotência e integração ainda precisam maturidade | P0/P1 |
| 5 | Frontend | Parcial forte: agenda dia/semana/mês/lista, drag, mobile, tema e toasts; faltam acessibilidade comprovada e waitlist | P1 |
| 6 | IA | Não implementado de forma material; correto adiar | P3 |
| 7 | DevOps | Parcial: CI e Vercel existem; faltam staging, migration gate, alertas, restore e runbooks | P0/P1 |
| 8 | Roadmap consolidado | Existe um `ROADMAP.md`, mas está desatualizado e não funciona como gate de execução | P1 |
| 9 | Billing SaaS | Não implementado; `Salon.plan` é enum, não cobrança. Pacotes do salão não são billing da plataforma | P2 |
| 10 | Operação solo | Quase não implementado: faltam base de conhecimento, suporte, incidentes, métricas e rotinas | P1 |

Ordem recomendada de execução:

1. arquitetura, banco, backend e DevOps críticos;
2. produto e agenda;
3. frontend e operação solo;
4. billing do SaaS;
5. IA somente depois de dados, métricas e controle de custo.

## 5. Agenda-alvo

A agenda atual já oferece dia, semana, mês, lista, filtros, busca, mover,
redimensionar e ações de status. O próximo salto de qualidade não é cosmético:
é modelagem e automação operacional.

### Sequência recomendada

1. **Multi-serviço:** substituir o único `serviceId` por uma reserva com um ou
   mais segmentos/serviços, mantendo snapshots de duração e preço.
2. **Disponibilidade por bloco completo:** considerar soma de serviços,
   intervalos, profissional por serviço, folgas, pausas e constraints.
3. **Lista de espera MVP:** cliente autenticado escolhe serviço, profissional
   opcional, intervalo de datas e faixas de horário; o salão também pode
   cadastrar manualmente.
4. **Oferta de vaga:** quando houver cancelamento, criar oferta expirada e
   notificar. No MVP, não agendar automaticamente e não segurar o horário.
5. **Reserva concorrente:** o primeiro aceite que vencer a constraint do banco
   fica com a vaga; os demais recebem alternativas.
6. **Anti-no-show:** confirmação, lembretes, política de cancelamento e,
   posteriormente, sinal ou pagamento antecipado.
7. **Otimização de buracos:** oferecer modos configuráveis: horários regulares,
   reduzir lacunas ou eliminar lacunas.

Booksy notifica clientes quando uma vaga aparece, mas não segura nem agenda
automaticamente o horário. Fresha oferece estratégias manual/automática e
prioridades como ordem de entrada, valor ou oferta a todos. Para este SaaS, o
MVP deve começar com ordem de entrada ou oferta a todos, sem decisão automática
por valor:

- [Booksy: funcionamento da lista de espera](https://support.booksy.com/hc/en-us/articles/16463469277714-How-does-the-waitlist-work)
- [Fresha: configuração da lista de espera](https://www.fresha.com/help-center/knowledge-base/calendar/set-up-and-manage-your-waitlist)
- [Fresha: múltiplos serviços no agendamento](https://www.fresha.com/help-center/knowledge-base/online-profile/101646-learn-how-clients-book-appointments-online)
- [Fresha: otimização de intervalos](https://www.fresha.com/help-center/knowledge-base/calendar/101821-optimize-online-bookings)

### Critérios mínimos da waitlist

- toda linha tem `salonId` e identidade confiável;
- entrada pública exige sessão de cliente válida;
- serviço/profissional pertencem ao mesmo salão;
- expiração e cancelamento são explícitos;
- contato não é usado como prova de identidade;
- notificação é idempotente;
- aceite cria agendamento em transação e respeita a constraint anti-conflito;
- nenhum token, telefone ou e-mail aparece em logs;
- dois aceites simultâneos nunca ocupam a mesma vaga;
- métricas: entradas, vagas abertas, notificações, conversão e tempo para
  preenchimento.

## 6. Supabase Pro sem reescrita

O uso de Prisma sobre PostgreSQL torna a aplicação portável. A troca da
organização Supabase de Free para Pro aumenta quotas e recursos sem exigir
reescrita da aplicação. É possível continuar usando o Supavisor em transaction
mode.

O pool dedicado de planos pagos é uma otimização opcional. Para adotá-lo,
altera-se a `DATABASE_URL` na Vercel, preservando `DIRECT_URL` para migrations,
e executam-se testes de conexão, concorrência e rollback. Não se deve mudar
pool, ORM e plano no mesmo deploy.

Referências:

- [Supabase: planos e cobrança](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Supabase: conexões e poolers](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase: Prisma](https://supabase.com/docs/guides/database/prisma)

Antes de crescer, manter:

- `DATABASE_URL` no pool transacional e preparada para Prisma;
- `DIRECT_URL` somente para migration/administração;
- migrations versionadas e testadas;
- backup/restore testado;
- Storage com buckets e autorização por finalidade;
- RLS ou revogação de Data API coerente com o fato de o backend usar Prisma.

## 7. Ferramentas recomendadas

### Obrigatórias agora

- GitHub + Actions: código, PR, revisão e CI;
- Vercel: deploy, preview e variáveis;
- Supabase: PostgreSQL, Storage, backups e observabilidade do banco;
- Prisma: schema e migrations;
- Upstash Redis: rate limit distribuído;
- Resend: convite e e-mails transacionais;
- Sentry: erros do frontend e backend;
- UptimeRobot ou Better Stack: health check externo;
- gerenciador de senhas com MFA para GitHub, Vercel, Supabase, Resend e Upstash.

### Depois do primeiro piloto

- PostHog ou equivalente para funis de onboarding/agendamento;
- Stripe ou Mercado Pago para billing do SaaS;
- provedor WhatsApp oficial para confirmação e waitlist;
- central de suporte/base de conhecimento leve.

Não são necessários Kubernetes, microserviços, fila complexa ou aplicativo
Flutter neste estágio.

## 8. Próximas ações exatas

1. Tratar o `master` e a produção como fonte de verdade; não continuar a partir
   do checkout local antigo.
2. Inspecionar os logs do preview Vercel e corrigir a configuração comum às
   branches antes de usar preview como gate.
3. Revisar o PR #3 e executar teste de integração com PostgreSQL para
   criação/aceite/reenvio/cancelamento concorrentes.
4. Criar backup/ponto de restauração e homologar a migration do PR #3 antes de
   qualquer merge.
5. Confirmar `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` e alertas 429
   na produção.
6. Corrigir o upload: autorização por Membership/salão, prefixo tenant,
   conteúdo real e buckets separados por finalidade.
7. Remover ou implementar a oferta pública de 30%.
8. Criar ambiente de homologação e checklist de migration/rollback/restore.
9. Especificar e implementar multi-serviço antes da waitlist.
10. Implementar waitlist em lote separado, com testes PostgreSQL de corrida.
11. Rodar piloto com 1–3 salões e medir agendamento, cancelamento, no-show,
    ocupação e suporte antes de iniciar billing e IA.
