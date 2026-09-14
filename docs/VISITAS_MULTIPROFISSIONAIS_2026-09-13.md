# Visitas com vários profissionais e autonomia de agenda

## Escopo aprovado em 13/09/2026

O cliente escolhe até dez serviços em uma jornada, define o profissional de
cada um (atribuição automática quando há apenas um; opção sem preferência
quando há vários), consulta horários para a visita completa, revisa e confirma
uma vez. Cada profissional recebe seu atendimento; Minhas reservas reúne os
atendimentos vinculados à mesma visita. Alterações/cancelamentos continuam por
atendimento, respeitando a política existente.

A equipe usa **Agenda → Novo agendamento → Adicionar serviços com profissionais
diferentes**. Pode escolher horários próprios por serviço ou deixar a sequência
automática. Dono, gerente e recepção podem combinar profissionais. O profissional
atua apenas na própria agenda e conserva o acesso restrito aos seus clientes.
Também pode registrar, editar e reabrir suas próprias folgas/bloqueios, com
recorrência e motivo opcional. Bloquear a jornada mantém reservas existentes;
o profissional vê as reservas afetadas, sem receber cancelamento em lote.

Dono, gerente e profissional podem confirmar, com motivo, atendimento em folga,
intervalo, bloqueio pessoal ou fora do expediente. Isso também vale para editar
serviços e horários. Fechamento geral do estabelecimento e disputas de horário
ou recurso continuam sendo verificados. A autorização para encaixe sobre outro
atendimento permanece independente e restrita a dono/gerente no fluxo existente.
A edição aplica a exceção imediatamente; o aceite posterior mantém o ID,
preço, horário e histórico do atendimento.

Bloqueios pessoais após o expediente ampliam automaticamente a grade diária e
semanal. **Dia inteiro** permite visualizar/criar períodos fora da grade usual.
Folga integral não amplia por si só todos os dias para 24 horas.

Serviços simultâneos no aplicativo exigem profissionais diferentes e combinação
explicitamente habilitada em **Configurações → preferências de agendamento**.
Por padrão, todos os serviços ficam em sequência. A equipe pode organizar
simultaneidade manual, mantendo a disponibilidade de profissionais e recursos.

## Remarcação imediata — áudio de 21h29

A equipe salva a alteração e a reserva já ocupa o novo horário, liberando o
anterior, antes da resposta do cliente. A atualização e a solicitação de resposta
são atômicas, com locks de disponibilidade, versão e idempotência. Se houver
conflito não autorizado, nada muda. Serviços, recursos e preço são preservados
no destino; aceitar apenas registra a resposta, sem recalcular ou mover novamente.

Recusar notifica a equipe e exibe **Alteração recusada** na grade e nos detalhes.
O destino fica reservado até a equipe combinar outro horário ou cancelar de
forma explícita. Não há retorno automático à origem nem cancelamento silencioso.
A tela do cliente explica isso antes de recusar. Uma nova edição substitui a
solicitação pendente; respostas antigas não desfazem alterações posteriores.

Sem migration: a solicitação guarda `applicationMode: IMMEDIATE` no fingerprint
persistido pelo servidor. Propostas legadas mantêm o comportamento original,
e respostas públicas não podem forjar esse modo. A trilha de eventos registra
horário anterior, novo horário, autor e resposta; o vínculo da visita permanece.

## Cadastro sem reserva

O fluxo existente de cadastro público já cria `ClientProfile` vinculado ao salão;
a listagem do dono não exige agendamento anterior. Logo, uma conta criada no link
do salão já aparece para o dono antes da primeira reserva. Mantêm-se as exceções
existentes de cliente ocultado/unificado e a visibilidade limitada do profissional.
Esta entrega não modifica cadastro nem expõe clientes de outros estabelecimentos.

## Persistência, concorrência e limites

- Sem alteração de schema ou migration. Cada agenda conserva suas linhas de
  `Appointment`; serviços contínuos do mesmo profissional são itens da mesma reserva.
- O vínculo da visita é o evento imutável `VISIT_CREATED` em `AuditLog`, com IDs
  dos atendimentos e resumo. Reutiliza o padrão vigente das preferências e a
  tabela com SELECT/INSERT e RLS. A leitura recebe apenas IDs de reservas já
  autorizadas; nunca amplia o acesso com base no conteúdo do evento.
- Uma transação grava todos os atendimentos, produtos, eventos e vínculo, ou
  desfaz tudo. Chave de idempotência serializa repetições; locks ordenados por
  profissional serializam disputas com outras reservas. Os IDs de agendamentos
  novos são privados à transação quando o estoque é reservado.
- Preços, condições de preço variável, duração, atribuição e disponibilidade são
  recalculados pelo servidor. Mudanças invalidam a revisão. Produtos ficam uma
  única vez na primeira reserva, com estoque e total conferidos.
- Busca limitada a dez itens e orçamento de combinações, com leitura conjunta
  de jornadas e aberturas; não consulta o banco para cada horário sugerido.
  Sem horário completo, orienta trocar data/profissional ou usar sequência.
- Público não recebe autorização de folga, encaixe ou fechamento pelo payload.
  Sessão é revalidada no tenant antes de qualquer escrita; rate limit existente
  continua ativo. Escolhas temporárias de serviços/data usam sessionStorage;
  nenhum dado de identidade é salvo por esse novo fluxo.
- Não existe edição/cancelamento coletivo nesta entrega. Histórico e notificações
  operacionais permanecem por atendimento. A visita fica em um mesmo dia; serviços
  podem terminar à meia-noite, mas não atravessar para o dia seguinte.

## Validação e publicação

Implementação em `codex/multi-professional-visits`, base `ae4f1ff`, em checkout
isolado. Alterações pré-existentes do checkout de trabalho foram preservadas.
PostgreSQL 16 sintético em loopback, porta 56484, banco `salon_schema_ci`, com
backup e setup equivalente ao CI. Nenhum segredo, dado ou SQL produtivo usado.

Testes cobrem sequência, simultaneidade autorizada, compatibilidade, preços,
recursos, ofertas, concorrência, idempotência, rollback após falta de estoque,
isolamento com RLS e aceite de edição na folga. Jornada Playwright verifica cliente,
painel, agrupamento e bloqueio após expediente, em 320, 390 e 1440 pixels, com axe.
Resultados locais:

| Verificação | Resultado |
| --- | --- |
| `npm run lint` | Aprovado, sem avisos |
| `npx tsc --noEmit --incremental false` | Aprovado |
| `npm test -- --maxWorkers=4` | 198 arquivos, 1.084 testes aprovados |
| `npm run build` | Build otimizado aprovado |
| `npx vitest run src/lib/__tests__/visits-postgres.integration.test.ts src/lib/__tests__/visit-scheduling.test.ts` | 21 testes aprovados (10 com PostgreSQL real) |
| `npm run test:appointment-integration -- --no-file-parallelism` | 37 testes PostgreSQL aprovados |
| `npx playwright test tests/e2e/multi-visits.spec.ts --project=chromium --workers=1 --reporter=line` | Jornada aprovada, sete revisões com axe sem violações, sem erro JavaScript |

As integrações usam `APP_ENV=test` e `RUN_POSTGRES_INTEGRATION=1`; a jornada usa
`RUN_DATABASE_E2E=1`. A fixture antiga de RLS altera policies compartilhadas e
disputava locks com outros arquivos quando executados juntos. O CI passa a executar
esses quatro arquivos em sequência; os testes de concorrência internos permanecem.

Capturas em `test-results` são publicadas como evidência pelo CI. Inspeção visual
local confirmou resumo público, revisão do painel em 320 pixels e bloqueio 21–23h
na grade móvel. A ampliação do áudio também foi validada em PostgreSQL:
destino ocupado e origem disponível antes da resposta; retries concorrentes;
aceite sem mudança de preço/versão; recusa sem retorno; invalidação de solicitação
antiga e compatibilidade com propostas legadas. As três jornadas de visita,
navegação e edição passaram localmente em 1m24s. O CI anterior identificou
um botão com texto sem quebra em 320px e seletores antigos da exceção de jornada;
o botão foi corrigido e os testes preservaram suas verificações de acessibilidade.
CI/Preview do PR ainda precisam concluir antes de publicação.

O CI `34795351030` aprovou lint, tipos, testes unitários, build e Preview, mas
identificou uma fixture antiga de billing que usava o dia UTC como data de
pagamento. Entre 21h e 24h em São Paulo, a data era futura e impedia testar a
recusa de confirmação manual do Mercado Pago. A fixture passa a usar o fuso
do HQ; nenhuma regra financeira mudou. Os 62 testes PostgreSQL de billing
passaram localmente após essa correção.

A revisão está no [PR #109](https://github.com/alisonbielwhats1-beep/barber-saas/pull/109).
A autorização de implementação não promove automaticamente a produção. A
publicação segue revisão, CI/Preview e aprovação do responsável.
