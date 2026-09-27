# Gate 2.5 — Financial Core (somente leitura)

## Auditoria anterior à implementação

Base isolada: `codex/financial-core`, a partir do MVP baseado em `9b92138`.
Não altera produção, sete agentes internos, credenciais ou regras de cobrança.

Fontes auditadas:

- R5 §6.4 e T09 `get_financial_summary`: leitura agregada, períodos resolvidos no backend,
  definições/coverage explícitos e percentual indefinido quando base zero.
- `src/lib/dashboard.ts:255`: faturamento = soma de `Appointment.priceCents` dos
  COMPLETED por `startAt`; ticket = essa soma / número de atendimentos concluídos.
- `src/lib/finance.ts:57`: realizado = serviços + produtos de atendimentos COMPLETED;
  recebido = `Payment.amountCents` por `paidAt`; a receber = COMPLETED sem Payment,
  serviços + produtos, sem recorte de período (estoque atual de recebíveis).
- `src/lib/finance-period.ts:5`: calendário do salão; semana começa domingo.
- `src/lib/kpis.ts:249`: ranking legado atribui o total ao serviço principal. Com
  múltiplos serviços isso não é alocação confiável: T09 usa snapshots
  `AppointmentService`, só quando sua soma coincide com o total do atendimento.
  Cobertura incompleta invalida o ranking inteiro, sem rateio inventado.
- `prisma/schema.prisma:1252`: snapshots de serviço/preço; `:1496`: produtos;
  `:1531`: Payment único por Appointment, sem status de estorno/taxa de gateway.
- `src/lib/comanda-service.ts:269`: fechamento incorpora extras, acréscimos e descontos
  em amountCents. Não subtrair descontos novamente do recebido.
- `src/lib/role-permissions.ts:10`: FINANCIAL_ROLES; autorização reconsulta Membership
  e estado APPROVED do Salon. RLS Payment deriva o tenant do Appointment.

Não existe Order financeiro de salão neste schema. BillingCharge/Mercado Pago de
assinaturas da plataforma não representa vendas do salão e fica fora desta Skill.
Cancelados/NO_SHOW/PENDING não compõem realizado nem ticket. Payment persistido
continua compondo recebido mesmo se o Appointment tiver outro status: não há um
registro de estorno que permita inferir devolução. A resposta explicita essa limitação.

## Decisões e diferenças da R5

“Faturamento” sem qualificador segue o dashboard: receita bruta de serviços concluídos,
não caixa nem líquido. A resposta sempre explicita a definição. Realizado com produtos,
recebido e a receber são métricas distintas. Sem lucro líquido, taxas, estorno, previsão,
baixa, método de pagamento, filtros livres ou escrita financeira neste Gate.
Não pedir SELECT em novas colunas para ampliar essas funcionalidades.

T09 recebe métricas publicadas, período e comparação opcionais e agrupamento publicado.
Não aceita SQL, tenant, projeção livre ou IDs fornecidos pelo modelo. Se falta período,
continua a consulta na mesma sessão. Recebíveis são um saldo atual, sem comparação
histórica inventada. Datas relativas tornam-se intervalos [início,fim) no timezone real.
Intervalos semanais/mensais são calendários completos, com as_of explícito (o período
atual pode estar em andamento). Ticket sem atendimentos é null, não R$0.

## Ajuste administrativo local autorizado

Somente SELECT(appointmentId,amountCents,paidAt,currency) em Payment para
mvp_service_runtime. `scripts/setup-financial-mvp-access.ts` exige preflight local,
RLS/FORCE e ACL prévia vazia; grava backup e rollback antes do GRANT.
Backup desta execução: `%TEMP%/everflair-gate25-acl/payment-before.json`.
Rollback: `%TEMP%/everflair-gate25-acl/rollback.sql` (somente REVOKE dessas quatro colunas).
Não reaplicar migrations, não modificar policies nem grants de outras tabelas.

## Implementação e contrato

Um Agent normal, mesma fábrica e mesmo Runner do Gate anterior. Nenhum Agent extra,
handoff, hosted tool, container ou alteração de credencial. `store:false`, tracing
desabilitado e limite de uma inferência por mensagem preservados.

Registry: services, customers, scheduling e financial habilitadas; Financial 1.0.0,
operação `financial.report`, capacidades U02/T09. Não publica Tools financeiras de
escrita. Seleção inicial e interpretação compartilham a mesma inferência; apenas
catálogo/esquemas inicialmente. U01 carrega/hash somente manuais selecionados.
Continuação Financial recebe somente seu manual completo. T09 é coordenada pelo
backend depois da interpretação, sem outra inferência para chamar a consulta,
somar números ou redigir a resposta. A Function Tool do Agent continua sendo o
contrato de interpretação já existente, nunca SQL nem escrita genérica.

Entrada tipada estrita de T09:

```ts
{
  metrics?: ("service_revenue" | "realized_revenue" | "received_revenue" |
    "completed_count" | "average_ticket" | "outstanding_receivables")[];
  period?: "today" | "yesterday" | "this_week" | "last_week" |
    "this_month" | "last_month";
  compare_period?: /* mesmo enum */;
  group_by?: "professional" | "service";
}
```

Schema de interpretação também admite null como omissão. Tenant, identidade e
timezone vêm exclusivamente do servidor; não são aceitos na entrada do modelo.
Agrupamento só para service_revenue, até dez resultados, sem comparação agrupada.
IDs usados internamente no GROUP BY/desempate não aparecem nos grupos de saída.

| Métrica | Fórmula/fonte | Data |
|---|---|---|
| service_revenue | SUM Appointment.priceCents, COMPLETED | startAt |
| realized_revenue | anterior + SUM(quantity × priceCentsUnit) dos produtos desses atendimentos | startAt |
| received_revenue | SUM Payment.amountCents; ajustes já incorporados | paidAt |
| completed_count | COUNT Appointment COMPLETED | startAt |
| average_ticket | service_revenue / completed_count; null com denominador zero | startAt |
| outstanding_receivables | COMPLETED sem Payment, serviços + produtos | saldo atual, todas as datas |

Comparação: atual − anterior; percentual = diferença / anterior × 100; base zero
retorna null/ZERO_BASE. Valores monetários são centavos; ticket pode ter fração de
centavo no DTO, formatado para duas casas na apresentação. Não há conversão cambial.
Moeda divergente em Payment/produto torna a métrica indisponível; não soma moedas.
Appointment não guarda moeda histórica própria: receita de serviços segue a moeda
do salão, mesma limitação do domínio existente.

DTO: resolved_period (start_at/end_at absolutos, datas locais e timezone), currency,
as_of, metrics (id/value/unit/definition/coverage/reason), groups mínimos, comparison,
warnings e durations_ms. Não inclui telefone, e-mail, cliente, Payment ID,
passwordHash, credenciais ou registros brutos. Coverage: COMPLETE/NO_DATA/UNAVAILABLE.
Consulta bem-sucedida vazia gera soma/contagem zero e NO_DATA; ticket null. Falha de
query/permissão propaga erro, nunca retorna zero. Snapshots inválidos não viram ranking.

## Continuidade, composição e autorização

Consulta sem período fica NEEDS_INPUT na mesma operation_ref/sessão e preserva a
métrica. U02 publica requisitos; não cria draft/proposal de escrita para uma leitura.
Resposta completa fica DONE e não pode ser confirmada (`FINANCIAL_READ_ONLY`).
Financial + Services mantém dois filhos separados: resultado financeiro direto e
proposta de alteração independente, sem alterar serviço antes da confirmação.

Todas as queries passam por withTenant, filtro explícito salonId e RLS. Reconsulta
Membership e salão APPROVED sob lock compartilhado. FINANCIAL_ROLES define
SUPER_ADMIN/OWNER/MANAGER; a entrada atual da Secretária continua restrita a
OWNER/MANAGER/RECEPTIONIST, portanto apenas OWNER/MANAGER chegam à Financial pela
interface. Não abre os agentes internos do CRM nem amplia o acesso da interface.
RECEPTIONIST é rejeitado. Permissão financeira é revalidada também antes de
reapresentar resultado já guardado numa sessão composta após mudança de papel.

## Performance e telemetria

Uma instrução SQL parametrizada calcula agregados, ambos os períodos e ranking no
mesmo snapshot PostgreSQL. Nenhuma lista bruta é carregada para somar em JS. LIMIT 10
para ranking. Usa as tabelas/índices existentes; nenhum índice ou função nova.
Registra interpretação, período, query, agregação, formatação, backend e message_total.
message_total inclui coordenação/autorizações até o resultado, antes de persistir a
própria telemetria. Em pedido composto inclui a preparação da outra operação.
AuditLog guarda apenas tempos/fonte; não copia conteúdo financeiro ou conversa.
Usage reutiliza o recorder existente, sem dupla soma de reasoning.

Não foi adicionado fast-path financeiro: o pedido completo já usa uma inferência e
a interpretação de continuação permanece no contrato limitado do Agent. Não há
parser genérico de perguntas financeiras. Fast-path temporal existente permanece.

## Arquivos deste Gate

Novos:

- `packages/salon-secretary/src/financial-skill.ts`: manual, schema e requisitos.
- `src/lib/secretary-financial.ts`: T09, autorização, SQL, DTO, período, resposta e tempos.
- `src/lib/__tests__/secretary-financial.test.ts`: contratos/SDK fake/períodos/erros.
- `src/lib/__tests__/secretary-financial.integration.test.ts`: fixtures, valores e RLS reais.
- `scripts/setup-financial-mvp-access.ts`: ajuste administrativo mínimo autorizado.
- `docs/SECRETARIA_GATE_2_5.md`: auditoria/entrega.

Alterações incrementais em arquivos de Gates anteriores:

- `packages/salon-secretary/src/index.ts`: schema/manual Financial na fábrica existente.
- `packages/salon-secretary/src/skill-registry.ts`: entrada, descoberta e validação seletiva.
- `src/lib/salon-secretary.ts`: ramo read-only, composição e autorização.
- `src/lib/service-contract.ts`: U02 financial.report.
- `src/app/(admin)/servicos/secretaria/secretary-chat.tsx`: resultado sem botão de confirmação.
- `src/app/(admin)/servicos/secretaria/actions.ts`: mensagens dos erros específicos.
- `src/test/secretary-capability-plan.ts`: helper de seleção fake.
- `src/lib/__tests__/secretary-registry.test.ts`: quatro Skills publicadas.
- `src/lib/__tests__/salon-secretary-ui.test.tsx`: leitura + proposta separada na interface.

As demais alterações já presentes no worktree pertencem aos Gates anteriores.
Nenhum arquivo dos sete agentes internos, migration ou schema foi alterado.

## Validação e evidências

Fixtures com tenants A/B e tenant vazio são criadas e removidas apenas no descartável,
com autorização adicional explícita do usuário. mvp_test_admin prepara/limpa fixtures;
todos os handlers, consultas, asserções financeiras e testes RLS usam mvp_service_runtime.
Fetch é bloqueado por fake que falha caso haja tentativa de rede no teste PostgreSQL.

Casos: seis períodos/calendário/timezone/DST, comparação/base zero, ranking por receita
diferente de quantidade, ticket, desconto já incorporado, produtos e recebíveis,
cancelados/pendentes/no-show, falta de modelo de estorno, moeda incompatível,
snapshots ausentes e múltiplos serviços, cross-tenant positivo, contexto vazio/inválido,
role insuficiente/revogada, zero vs erro, DTO mínimo, composta Financial+Services,
continuação, nenhuma confirmação financeira e ausência de efeitos operacionais.

Valores esperados da fixture A em 23/09/2026 (relógio injetado no teste): ontem
service_revenue=21000, realizado com produtos=25500, recebido=10500, quatro
atendimentos, ticket=5250. Hoje service_revenue=6000; semana atual=27000,
anterior=3000, diferença=24000/+800%. Recebíveis atuais=9500 centavos.
Pagamento de appointment cancelado permanece na métrica de recebimento registrado,
sem ser contado como serviço realizado; não há estorno fictício.

Payment: runtime lê cinco registros próprios de A e cinco de B; A→B e B→A retornam
vazio, inclusive com appointmentId estrangeiro explícito. Contexto ausente/inválido
retorna vazio. Leitura de id (coluna não autorizada) falha por permission denied.
Grants finais exatamente SELECT(appointmentId,amountCents,paidAt,currency), sem
SELECT de tabela ou escrita. RLS=true, FORCE=true, tenant_isolation preservada;
runtime rolsuper=false, rolbypassrls=false. Nenhuma nova dependência administrativa.

Resultados executados:

- `npm run lint`: passou.
- `npx tsc --noEmit --incremental false`: passou.
- `npm test`: 1.330 testes / 231 arquivos passaram (inclui regressões mockadas de
  Services, Customers, Scheduling, Registry, usage e interface).
- Rodada direcionada Financial + Registry + UI + PostgreSQL: 56 testes passaram.
- Após acrescentar cobertura de produtos a receber e múltiplos serviços: rodada
  PostgreSQL final `secretary-financial.integration.test.ts`, **18/18 passaram**.
- `npx prisma validate`: schema válido, sem alteração de schema/migration.
- `npm run build`: passou, inclusive `/servicos/secretaria`. Usa configuração
  sintética local via ambiente do processo, sem editar NEXTAUTH_SECRET real.

Logs locais: `%TEMP%/everflair-gate25-suite.log`, `everflair-gate25-final.log`,
`everflair-gate25-postgres-final.log`, `everflair-gate25-build-final.log`.
Aviso não bloqueante existente do Vite sobre config CommonJS/ESM. Sem falha de teste.
Não foram repetidas baterias pagas nem testes PostgreSQL específicos de Scheduling.

Amostra final (modelo fake + PostgreSQL local, sem extrapolação para produção):
interpretação 49,81 ms; período 1,06 ms; query 0,69 ms; agregação 0,012 ms;
backend T09 2,33 ms; formatação 3,09 ms; mensagem completa composta 93,89 ms.
Os tempos são etapas aninhadas, não devem ser somados novamente. Não medem Luna real.
Descoberta permanece uma Function Tool / uma inferência fake, inclusive composto;
continuação por período ausente usa uma inferência fake adicional. Financial não
reinterpreta os resultados, e nunca recebe linhas financeiras de volta no modelo.

Progressive Disclosure observado nos testes: nenhum manual completo na descoberta;
somente Financial na continuação financeira, sem Financial em continuação de outra
Skill. Catálogo/schema inicial cresce com a quarta Skill: payload de exemplo
Services 9.789 caracteres versus 4.630 no antigo seletor manual Services, ambos
uma inferência. Não se declara redução de tokens; o ganho preservado é uma única
interpretação para seleção + pedido composto, sem carregar todos os manuais completos.

## Limitações e rollback

Sem teste Luna real nem benchmark de carga. Sem estorno/taxa/receita líquida,
histórico de recebíveis, período livre, ranking por quantidade, filtro por pessoa,
meio de pagamento ou comparação agrupada. Isso não é convertido silenciosamente
em outra métrica. Recebíveis não aceitam período, e o erro explica o saldo atual.
Sem persistência avançada de sessão; mantém limite/expiração da arquitetura existente.
Sem novo E2E de navegador: interface verificada em jsdom e build local.

O job CI schema-smoke completo não foi disparado: recria schema/aplica migrations
e usa serviço PostgreSQL em container, fora da autorização. Foram usados PostgreSQL
nativo, testes direcionados, validação Prisma e inspeção de ACL/RLS. Não se declara
o job CI remoto aprovado. Não houve push/PR/deploy.

Rollback de código: reverter somente os incrementos listados deste Gate e retirar
os seis arquivos novos; preservar mudanças anteriores. Baseline dos sete arquivos
principais em `%TEMP%/everflair-gate25-before`; em actions.ts remover apenas as quatro
mensagens Financial, e no teste UI remover apenas o novo caso Financial. Não usar
git reset/clean: Gates anteriores ainda estão no worktree.
Rollback do grant, somente após preflight no mesmo descartável, usando o SQL salvo:
REVOKE SELECT dessas quatro colunas. Não mexe em RLS/policies nem outros grants.
As fixtures desta suíte têm IDs próprios e são limpas no afterAll; não alteram dados
do salão demo nem dados reais. Rollback de código/grant não foi executado.

## Validação Luna recomendada, somente após autorização

1. “Quanto faturei ontem?”: uma inferência, período real e soma confrontada com fixture.
2. “Compare esta semana com a semana passada.”: períodos/percentual do backend,
   incluindo base zero em fixture previamente preparada.
3. “Quanto faturei ontem e altere a massagem para R$80.”: leitura direta e proposta
   separada, sem confirmar a alteração. Não repetir testes de Scheduling.

Nenhuma chamada real autorizada neste Gate. Não avançar para Inventory.

Finalização: `SALON_SECRETARY_ALLOW_PAID_CALLS=false` reconfirmado em `.env.local` e
nos processos de teste. Zero chamadas OpenAI, sem container/hosted tool, sem push,
deploy ou acesso produtivo. O cluster nativo iniciado para esta execução foi
identificado por diretório/PID e encerrado; nenhum servidor web foi iniciado.
Gate 2.5 pronto para revisão do responsável; validação Luna permanece pendente
de autorização futura.
