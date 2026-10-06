# Gate 2.3 — reconciliação temporal determinística

Correção local de 21/09/2026, branch `codex/service-create-mvp`, base `9b92138`.
Não encerra o Gate nem autoriza novo teste pago. Nenhum prompt/Agent/manual,
modelo, credencial, grant, policy, migration ou configuração produtiva alterado.

Atualização após a revalidação real mínima: estado recebido/rejeitado agora fica
separado do estado efetivo. As regras abaixo incorporam essa correção final;
a validação real posterior ainda depende de autorização.

## Causa raiz auditada

Antes desta correção, `applySchedulingInterpretation` fazia
`c.fields={...c.fields,...patch}`; o adaptador U03 fazia outro merge equivalente,
`{...old?.fields,...p.fields}`. Assim, `period=afternoon` preservava `time=11:00`
nas duas camadas. Remover a hora só da memória também seria insuficiente: o
segundo merge poderia restaurá-la a partir do journal.

`assess` considerava apenas presença dos requisitos. O snapshot da remarcação
validava disponibilidade para a hora concreta, sem confrontá-la com o período.
No catálogo, o período filtrava alternativas, mas não o horário solicitado.
Portanto, mesmo um horário livre podia resultar em proposta semanticamente errada.

Na primeira correção, a ordem passou a ser merge → reconcile → persist → assess.
Porém o reconciliador só retirava a hora se `period` viesse **sem** `time` no patch.
Quando Luna repetiu11h junto de afternoon, nenhum ramo removeu o valor; assess
detectou TIME_OUTSIDE_PERIOD e bloqueou READY/proposta, mas persistiu ambos em
`fields`. `temporal_conflicts` descrevia o erro, não inativava os campos.

Agora `reconcileSchedulingTemporal` retorna `{fields,rejected}`. `fields` contém
somente valores efetivos; `rejected` contém apenas código, campo temporal e valor
rejeitado (sem conversa/prompt, nomes ou credenciais). O coordenador reconcilia
antes de preparar; U03 repete a validação contra a revisão persistida, para não
ressuscitar campos por merge. Na mesma transação, grava DRAFT com campos válidos
e evento separado `TEMPORAL_RECONCILED`, vinculado ao draft/revisão. A UI/modelo
recebem os campos efetivos, não os valores rejeitados do evento.

Representação real (`scheduling-contract.ts`):
- `date` e `source_date`: dias absolutos locais YYYY-MM-DD;
- `time` e `source_time`: horário destino e seletor de origem HH:mm;
- `end_time`/`end_date`: final explícito de bloqueio;
- `period`: morning/afternoon/evening, restrição sobre o início;
- `day_offset`/`weekday` e equivalentes source: convertidos para datas absolutas
  por `resolveSchedulingDate` no timezone autenticado, antes do merge;
- timezone: somente domínio/salão, não campo aceito do modelo;
- startLocal/endLocal, UTC, duração, preço, recursos e estado de aceite: snapshots
  derivados do domínio, revalidados para proposta/confirmação. Não são defaults
  inventados pelo modelo. O fim 00:00 sem end_date usa o dia seguinte, regra existente.

Services e Customers têm adaptadores U03 próprios; seus campos editáveis não
incluem esses campos temporais. Não há justificativa para impor semântica de
Scheduling ao journal comum. Seus merges e contratos permanecem intactos.

## Regra e precedência

`src/lib/scheduling-temporal.ts` concentra a regra pura, usada no coordenador e
no U03 persistente. Guardas também cobrem snapshots, disponibilidade, propostas
T12/T13/T14/T15 e execução da confirmação. T06 é leitura por referência, não
proposta; o coordenador impede consultas de estados temporais contraditórios.

| Situação | Resultado |
|---|---|
| Campo omitido/undefined independente | Preservar |
| Nova informação para o mesmo campo | Substituir o valor anterior |
| Novo período + hora antiga incompatível | Retirar somente a hora; pedir horário exato |
| Novo período + hora antiga compatível | Manter ambos |
| Nova hora concreta + período antigo incompatível | Nova hora prevalece; retirar restrição antiga |
| Hora e período novos, incompatíveis no mesmo patch | Retirar a hora, mesmo repetida; NEEDS_INPUT e pedir hora exata |
| Fim anterior/igual ao início após edição | Retirar end_time; se end_date anteceder date, retirar também end_date; pedir final correto |
| Nova data | Preservar cliente/serviço/profissional e hora explícita; revalidar intervalo/snapshot |
| Snapshot/valor derivado anterior | Nunca sobrepor entrada nova; recomputar ou descartar se incompleto |
| Default ou hora inferida | Não introduzir hora; defaults temporais não existem neste contrato |

Limites reutilizados da disponibilidade real: morning [00:00,12:00), afternoon
[12:00,18:00), evening [18:00,24:00). Não dependem de texto específico do usuário.
São horários locais do salão, não faixas UTC.

O contrato não registra proveniência por campo (explícito/inferido) no histórico.
Não a inventamos retroativamente: todo valor concreto anterior é tratado
conservadoramente como já informado. Novos patches devem conter extração explícita;
reconciliação não consegue provar se o modelo inferiu indevidamente algum valor.
Valores realmente derivados ficam nos snapshots, fora do patch linguístico.

Precedência: invariantes do backend → intenção temporal nova válida → valores
concretos compatíveis → valores anteriores → defaults existentes do domínio.
Um período fornecido invalida hora incompatível também quando ambos chegam
juntos; a decisão não se baseia apenas em presença/ausência. Uma nova hora sem
novo período ainda pode substituir a restrição anterior, como já aprovado.

Conflitos resolvidos por retirada deixam `temporal_conflicts=[]` no estado
efetivo, pois já não existem dois valores ativos contraditórios. A causa/valor
ficam no evento histórico `TEMPORAL_RECONCILED`. `temporal_missing=[time]` (ou
end_time) mantém a necessidade de esclarecimento mesmo em operações nas quais
o campo não seria obrigatoriamente exigido pelo schema básico. Campos omitidos
em mensagens subsequentes não encerram essa pendência; valor válido a resolve.
`status=NEEDS_INPUT`, `missing_fields` e `waiting_for` orientam a pergunta.

O metadado opcional temporal_missing participa do hash da proposta quando existe;
histórico antigo sem esse campo continua parseável e com hash compatível. Não
há enum/migration novo. O journal avança a revisão, invalidando proposta anterior.
Não há escrita operacional nesses estados; apenas draft e auditoria.

Referência de cancelamento é invalidada quando muda seu seletor temporal; o
resolvedor considera o período ao relocalizar candidatos. Leituras de agenda
também filtram esse período. Regras de tenant/role, recursos e aceite permanecem.

## Reprodução corrigida

1. Mesmo draft aguarda somente `time`.
2. “11h” usa o fast-path existente, sem inferência, e prepara proposta11h.
3. “depois do almoço” é recusado pelo parser restrito e segue para modelo fake.
4. Tanto `{period:"afternoon"}` quanto `{period:"afternoon",time:"11:00"}`
   retiram `time` da memória **e do draft persistido**. O evento histórico guarda
   TIME_OUTSIDE_PERIOD/field=time/value=11:00; o estado efetivo não guarda11h.
5. Mesmo operation_ref/draft_ref, revisão nova, NEEDS_INPUT/missing_fields=[time].
6. Resposta: “O horário anterior é incompatível com o período informado e foi
   retirado. Informe o horário exato desejado.” Sem proposta/snapshot executável.
7. Confirmar a proposta anterior falha com REVISION_CONFLICT, sem escrita operacional.
8. Resposta posterior inequívoca14h passa pelo mesmo fast-path/validação e pode
   preparar nova proposta14h; esse passo foi testado apenas com fake.

## Arquivos desta correção

Novos:
- `src/lib/scheduling-temporal.ts`;
- `src/lib/__tests__/scheduling-temporal.test.ts`;
- este documento.

Alterados:
- `src/lib/secretary-scheduling.ts`;
- `src/lib/scheduling-actions.ts`;
- `src/lib/scheduling-catalog.ts`;
- `src/lib/scheduling-mutations.ts`;
- `src/lib/__tests__/secretary-scheduling-actions.integration.test.ts`;
- `src/lib/__tests__/secretary-scheduling.integration.test.ts`.

## Validação anterior sem OpenAI (primeira correção)

- 17 novos testes unitários: A–G, limites de período, intervalo dependente,
  meia-noite, ausência de defaults e seletores relativos não resolvidos.
- 7 novos casos PostgreSQL: sequência exata que falhou; guardas diretas U03/
  proposta para quatro operações; isolamento composto; criação com mudança de
  período/hora/data, preservação de referências e guarda da disponibilidade.
- Uma expectativa antiga foi atualizada: intervalo inválido agora retorna
  NEEDS_INPUT com esclarecimento, em vez de lançar erro genérico. Escrita segue negada.
- `npm test`: 229 arquivos / 1.302 testes aprovados.
- PostgreSQL: 45 testes Scheduling aprovados na rodada final; outras cinco suites
  de regressão passaram na primeira rodada (57 testes). Total dos sete arquivos:
  102 casos aprovados nas execuções correspondentes, sem chamada real ao modelo.
- `npm run lint`, `npx tsc --noEmit --incremental false` e `npm run build` aprovados.
  Build com segredo NextAuth sintético somente no processo e banco runtime local;
  nenhuma configuração persistente de autenticação alterada.
- PostgreSQL descartável previamente identificado por host/porta/banco/diretório;
  fixtures com admin local, operações funcionais exclusivamente mvp_service_runtime.
  Testes incluem RLS/FORCE, NOSUPERUSER/NOBYPASSRLS, concorrência, idempotência,
  aceite, fila, criação, alteração, cancelamento, bloqueio, Services e Customers.
- Fetch proibido nos testes funcionais; SALON_SECRETARY_ALLOW_PAID_CALLS=false.

Logs locais: `%TEMP%/temporal-unit.log`, `temporal-pg.log`,
`temporal-pg-final.log`, `temporal-lint.log`, `temporal-tsc-final.log`,
`temporal-build.log`. Nenhum novo SQL administrativo ou mudança de RLS/grants.

## Validação final do estado efetivo — sem OpenAI

Arquivos alterados nesta última correção (nenhum arquivo de produto novo):
`scheduling-temporal.ts`, `scheduling-actions.ts`, `secretary-scheduling.ts`,
`scheduling-temporal.test.ts`, `secretary-scheduling-actions.integration.test.ts`
e este documento. Catálogo, mutations, prompts, Agent, Registry e demais Skills
não foram alterados nesta rodada.

Testes agora incluem o patch real com repetição de11h; mesmo resultado do patch
mínimo; auditoria do rejeitado sem campo ativo; 14h posterior com afternoon;
11h/morning e14h/afternoon; referências preservadas; revisão antiga rejeitada;
pendência conservada após patch de motivo; guardas U03/propostas das quatro
operações; Services/Customers, idempotência/concorrência e RLS existentes.

PostgreSQL: sete suites,103 testes aprovados; após reforçar a preservação da
pendência em patches independentes,28 testes Scheduling Actions novamente
aprovados. Roles e ambiente permanecem os já autorizados; nenhum novo grant.
`npm test`:229 arquivos/1.305 testes aprovados. `npm run lint`,
`npx tsc --noEmit --incremental false` e `npm run build`: aprovados.
Build usou somente segredo NextAuth sintético no processo e banco runtime local.
Zero chamadas reais; SALON_SECRETARY_ALLOW_PAID_CALLS=false antes/depois.
Cluster local encerrado após os testes; nenhum servidor pago iniciado.
Logs: `%TEMP%/temporal-effective-*.log`.

## Próxima revalidação real mínima preparada — NÃO EXECUTADA nesta correção

Somente depois de nova autorização, usando conta OWNER/salão/projeto/modelo locais
já aprovados e revalidando o banco descartável. Pré-condição: um único agendamento
ativo de Amanda Prado, profissional Tatiana, destino11h livre excluindo a própria
reserva. Data relativa calculada no dia da futura execução; não fixar amanhã em22/09.

1. Preparar deterministicamente um draft de remarcação com referências reais
   resolvidas e somente time faltante; nenhuma frase inicial/inferência.
2. “11h” — zero inferências, mesmo operation/draft, proposta11h não confirmada.
3. “depois do almoço” — exatamente uma inferência esperada; MODEL, period=afternoon;
   time ausente, NEEDS_INPUT, mesma referência de draft, nova revisão, sem proposta.
   Aceitar a possibilidade de Luna repetir time=11:00: também deve ser retirado.

Limite proposto: uma conversa, uma inferência, zero retries, zero confirmações.
Não repetir cancelamento/bloqueio nem efetivar remarcação. Parar na primeira
divergência. Capturar usage/latência e retornar flag paga=false no finally.
Este roteiro não executa nem autoriza chamadas. Servidor pago não foi iniciado.
Ao finalizar os testes, o cluster local foi encerrado; a flag paga permanece false.

## Limitações e rollback

Sem novo parser genérico, taxonomia de períodos, timezone fornecido pelo modelo,
memória avançada, Scheduling Batch ou framework global de dependências. A regra
cobre os campos temporais publicados; futuras Skills precisarão declarar suas
próprias dependências. Não há reparo em massa de drafts históricos: proposta e
execução revalidam os campos; recibos idempotentes já executados são preservados.

Backup anterior a esta última correção:
`%TEMP%/everflair-temporal-effective-before-1789984010030` (cinco arquivos de
código/testes + este documento). Preservar o backup da primeira correção também.
Rollback de código: restaurar somente esses arquivos, sem reset/clean; preservar
Gates e histórico. Não remover eventos de auditoria. Não há migration a reverter.
Como o parser anterior era strict, drafts novos com temporal_missing não devem
ser reabertos pelo código antigo: encerrar sessões e iniciar drafts novos após
rollback, mantendo evidências/recibos históricos. A restauração reintroduz a
divergência; manter chamadas pagas desabilitadas até revisão. Roll-forward é
preferível se houver drafts em uso. Nenhum rollback executado.
