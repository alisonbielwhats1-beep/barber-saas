# GPT-6 Luna Golden Battery V2 — fixtures locais

Atualização de 2026-09-23: bateria real concluída com 10/10 casos funcionais aprovados. `gpt-6-luna` foi promovido **somente na configuração/codebase local** no Gate 3.1B.1; o registro de preparação abaixo permanece histórico. A telemetria HTTP individual do caso 6 não foi recuperada, mas usage, inferência e proposta foram persistidos. Ver `SECRETARIA_GATE_3_1B_PROMOCAO.md`.

Estado em 2026-09-22: preparada e validada **sem inferência**. A V1 em `gpt6-luna-candidate.ts` permanece congelada e não deve ser usada contra o estado atual do banco. As mensagens da V1 dependiam de Amandas/Fábios homônimos, uma Amanda cancelada, Fábio no slot, Financial datado e contatos de Communication de outro Gate. Restaurar tudo isso no mesmo salão destruiria a independência entre cenários.

## Contrato e data-base

O manifest versionado `gpt6-luna-golden-v2.ts` é a fonte única de mensagens, expected e referências locais. `createGpt6V2Manifest(baseDate)` congela uma execução: `baseDate` é a data **civil** no fuso `America/Sao_Paulo`; `amanhã` e `ontem` derivam dessa data. O precheck exige que `baseDate` ainda seja a data civil atual no mesmo fuso. Se virar o dia, a bateria paga não pode usar o manifest antigo; gerar uma nova instância e rodar `reset` + `precheck` antes de solicitar autorização. As mensagens ficam iguais para a nova data.

Cada caso tem um salão sintético exclusivo `g6v2-AAAAMMDD-<case_id>-salon`, OWNER sintético próprio e IDs determinísticos. Nenhum ID, valor Financial, saldo, expected ou telefone vai no texto enviado ao modelo. A separação de salões impede que serviços, pessoas, compromissos ou produtos de um caso contaminem outro. Não há senha de login válida nas novas contas.

| # | Case ID | Mensagem exata V2 | Condição e resultado esperado |
| --- | --- | --- | --- |
| 1 | `services-create` | `Cadastre uma massagem relaxante Aurora por R$50.` | `service.create`; nome novo; preço 5.000 centavos; duração ausente; `NEEDS_INPUT`. |
| 2 | `services-price` | `Altere o preço da Hidratação Capilar Aurora para R$80.` | Serviço ativo R$60 → `service.change`, preço 8.000 centavos; proposta sem confirmação. |
| 3 | `customers-create` | `Cadastre Maria Clara de Alencar.` | Nome composto ausente no tenant → `customer.create`; proposta. |
| 4 | `scheduling-create` | `Marque Camila Lemos amanhã às 10h com Tatiana Almeida para Progressiva Aurora.` | Cliente, serviço e profissional únicos; amanhã 10h livre → `appointment.create`; refs backend; proposta. |
| 5 | `scheduling-change` | `Passe a Amanda Ribeiro de amanhã às 10h para 11h.` | Appointment próprio `CONFIRMED`, versão 1, 10:00–11:00; 11h livre → `appointment.change`; proposta. |
| 6 | `scheduling-batch` | `Cancele a Amanda Batista de amanhã às 10h e coloque o Fábio Rocha nesse horário para corte masculino. Motivo: substituição solicitada pela equipe.` | Appointment próprio `CONFIRMED`, versão 1; `appointment.cancel → appointment.create`, dependência explícita; disponibilidade projetada; proposta única. |
| 7 | `financial-revenue` | `Quanto faturei ontem?` | Appointment `COMPLETED` ontem 10h; serviço R$120 e Payment sintético R$80; `financial.report/service_revenue/yesterday` = **R$120** pelo T09. |
| 8 | `inventory-low` | `Quais produtos estão com estoque baixo?` | Shampoo Aurora 1 ≤ 3; Condicionador Aurora 8 > 2; `product.search/low_stock` retorna **somente Shampoo Aurora**. |
| 9 | `communication-exact` | `Mande exatamente para o Fábio Nogueira no WhatsApp: “Serviço cancelado, Fábio.”` | Cliente único, contato sintético elegível; `customer.message/WHATSAPP/EXACT`, preview idêntico; nenhuma Outbox. |
| 10 | `communication-dependent-name` | `Cancele a Amanda Maria de Souza de amanhã às 14h e mande exatamente no WhatsApp: “Amanda, seu horário foi cancelado.” Motivo: teste controlado.` | Nome composto íntegro; Appointment próprio `CONFIRMED`; `appointment.cancel → customer.message`; destinatária é a mesma cliente; serviço ausente na interpretação; preview EXACT; nenhuma Outbox. |

Todos os dez casos têm `confirmation_allowed=false`. Casos 4, 5, 6 e 10 possuem profissionais/agendamentos distintos **em salões distintos**. Podem rodar sequencialmente sem confirmação, sem alterar as pré-condições de outro caso. Financial e Inventory também estão isolados das fixtures antigas. A comparação com GPT-5.6 Luna histórico é `FUNCTIONALLY_EQUIVALENT`, **não pareada**: nomes, datas, tenant e referências diferem. O comportamento exigido por Skill/operação/dependências não foi reduzido.

## Procedimento local restrito

No worktree `service-create-mvp`, com `.env.local` existente, executar somente:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/gpt6-luna-v2-fixtures.ts reset --base-date=AAAA-MM-DD
node node_modules/tsx/dist/cli.mjs scripts/gpt6-luna-v2-fixtures.ts precheck --base-date=AAAA-MM-DD
```

Nesta máquina, `tsx` requer um workaround temporário do launcher Node para `uv_os_get_passwd`; ele não muda o código do produto ou o banco. O script exige `APP_ENV=test`, paid flag `false`, modelo ativo `gpt-5.6-luna`, `DATABASE_URL` com `mvp_service_runtime` e `DIRECT_URL` com `mvp_test_admin`, ambos exclusivamente `127.0.0.1:55441/everflair_service_mvp`. Também compara identidade real do PostgreSQL, cluster descartável, role sem superuser/BYPASSRLS e RLS/FORCE nas dez tabelas relevantes. Nenhum segredo/URL completo é impresso.

`reset` faz backup `pg_dump -Fc` em `%TEMP%` **antes** de qualquer escrita, cria apenas salões V2 ausentes em transações por caso e executa precheck integral. Ao ser repetido sobre fixtures válidas, cria **zero** registros e não altera os existentes. Se houver drift em um salão V2 existente, o precheck falha fechado. Não remove drafts, proposals, eventos, Outbox ou histórico para “consertar” a comparação. A reprodução para outra data cria outro namespace V2 isolado. Este não é um reset genérico do banco.

O precheck é somente leitura via `mvp_service_runtime` para os dez casos: unicidade dos nomes, status/versões/snapshots, elegibilidade de serviço/profissional, disponibilidade normal e projetada, soma real T09, `stock <= minStock` via T24, contato elegível via T10, OWNER, RLS/FORCE e cross-tenant. Se qualquer um falhar: **zero chamadas pagas**. O comando não invoca Agent, OpenAI, JEV, Tool de escrita, confirmação ou provider.

## Evidência local e rollback

Em 2026-09-22, `reset` criou os dez salões V2 e `precheck` confirmou **10/10**, T09 **12.000 centavos**, Inventory **um produto baixo**, slots livres/projetados e cross-tenant visível **0**. Uma segunda execução de `reset` criou **0** registros; o backup anterior à primeira escrita é `%TEMP%\everflair-gpt6-v2-DUuRbs\pre-reset.dump` (1.928.369 bytes). A segunda execução produziu também um backup posterior para auditoria. O precheck respeita o grant **colunar** existente de Payment usando apenas `appointmentId`, `amountCents`, `paidAt` e `currency`; nenhum grant novo foi necessário.

Rollback, se solicitado: **não** executar `pg_restore` indiscriminadamente sobre a base em uso. Primeiro interromper qualquer execução, verificar o mesmo host/porta/database/cluster e comparar o estado atual com o dump anterior à criação. Somente com autorização específica para restaurar a base descartável, restaurar esse dump em ambiente descartável, ou remover exclusivamente os dez salões V2 e usuários sintéticos criados por este script após comprovar que não receberam eventos operacionais. Os dados dos Gates anteriores não devem ser apagados. Para rollback somente de código, remover o manifest V2, script, testes e este documento; V1 e runtime da Secretária não foram modificados.

## Próxima bateria (não executada)

Em data de execução futura: resolver nova `baseDate`, repetir `reset`/`precheck` até 10/10, congelar essa instância do manifest, revisar os dez textos/expecteds, cost guard/request serializada e autorização do responsável. Só então executar no máximo dez inferências GPT-6 Luna, uma por caso em ordem, zero retries/confirmações, parando no primeiro desvio material. GPT-5.6 e JEV permanecem somente baselines históricos; não executar novamente. O modelo ativo permanece `gpt-5.6-luna` e `SALON_SECRETARY_ALLOW_PAID_CALLS=false` até uma autorização separada.
