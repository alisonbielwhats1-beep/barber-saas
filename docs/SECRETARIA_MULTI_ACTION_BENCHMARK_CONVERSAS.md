# Multi-Action V2 — transcrições observadas

Respostas reais preservadas integralmente. Estes textos são sintéticos da fixture, não conversas de clientes reais. Os rótulos técnicos e repetições fazem parte do resultado medido.

## x40 — 1 ação(ões)

Avaliação adicional: CAPABILITY_SUPPORTED.

### Turno 1

USER

> Agenda o Andrinho amanhã às 10h para Corte Completo.

SECRETÁRIA

```text
NORMAL_REVIEW
agenda_andrinho. appointment.create — READY_FOR_CONFIRMATION
NOVO AGENDAMENTO
Cliente: Andrinho
Serviço: Corte Completo
Profissional: Tatiana
Data: 2026-10-06
Horário: 10:00–10:45 (America/Sao_Paulo)
Preço: R$ 50,00
Use Confirmar para executar.
Revise os grupos. Mutações exigem confirmação; leituras não autorizam escrita.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 4.684 s; Luna 4.233 s; backend 0.258 s.

conversation_ref: 8bfe6503-d9a4-408a-9fca-5d2499d74055; plan_ref: c6fd981f-2be2-4400-8bef-ddb06204d4f8; revisão: 2.

Draft refs:

```json
{
  "observed_1": "8d22af4a-4641-4951-a6ea-4195d61fb517"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T1": 107.59700000000157,
  "T2": 4340.161200000002,
  "T3": 4384.146000000001,
  "T4": 4641.972600000001,
  "T5": 4683.698500000002
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| agenda_andrinho | appointment.create | READY_FOR_CONFIRMATION | — | — |

Grafo: [].

Grupos: [{"key":"group_1","actions":["agenda_andrinho"],"review":"NORMAL_REVIEW","status":"READY_FOR_CONFIRMATION"}].

## x41 — 1 ação(ões)

Avaliação adicional: Pergunta de horário repetida; campos técnicos expostos..

### Turno 1

USER

> Marca um Corte Completo pro Andrinho amanhã.

SECRETÁRIA

```text
NORMAL_REVIEW
agendamento_1. appointment.create — NEEDS_INPUT; falta: time
Informe horário exato.
Informe somente agendamento_1: time.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 3.594 s; Luna 3.444 s; backend 0.032 s.

conversation_ref: 8460c688-c0c5-4592-9dea-5be9582e1585; plan_ref: 41dd815c-ffbd-4f6b-8a1a-62954d80d670; revisão: 2.

Draft refs:

```json
{
  "observed_1": "1ed05c96-0332-41b8-b294-07c8cbd980aa"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T1": 39.756099999998696,
  "T2": 3483.4127999999982,
  "T3": 3517.7178999999996,
  "T4": 3549.615600000001,
  "T5": 3593.989099999999
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| agendamento_1 | appointment.create | NEEDS_INPUT | time | — |

Grafo: [].

Grupos: [{"key":"group_1","actions":["agendamento_1"],"review":"NORMAL_REVIEW","status":"NEEDS_REVIEW"}].

### Turno 2

USER

> 10h.

SECRETÁRIA

```text
NORMAL_REVIEW
agendamento_1. appointment.create — READY_FOR_CONFIRMATION
NOVO AGENDAMENTO
Cliente: Andrinho
Serviço: Corte Completo
Profissional: Tatiana
Data: 2026-10-06
Horário: 10:00–10:45 (America/Sao_Paulo)
Preço: R$ 50,00
Use Confirmar para executar.
Revise os grupos. Mutações exigem confirmação; leituras não autorizam escrita.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 2.247 s; Luna 2.045 s; backend 0.102 s.

conversation_ref: 8460c688-c0c5-4592-9dea-5be9582e1585; plan_ref: 41dd815c-ffbd-4f6b-8a1a-62954d80d670; revisão: 4.

Draft refs:

```json
{
  "observed_1": "1ed05c96-0332-41b8-b294-07c8cbd980aa"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T3": 2119.2091,
  "T1": 39.03220000000147,
  "T2": 2083.8915000000015,
  "T4": 2220.887200000001,
  "T5": 2247.311600000001
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| agendamento_1 | appointment.create | READY_FOR_CONFIRMATION | — | — |

Grafo: [].

Grupos: [{"key":"group_1","actions":["agendamento_1"],"review":"NORMAL_REVIEW","status":"READY_FOR_CONFIRMATION"}].

Mudanças nos campos de intenção: [{"key":"agendamento_1","fields":["time"]}]. Mesmo plano: true; mesmo grafo: true; mesmos draft_refs: true. Assessments/previews/fingerprint podem mudar legitimamente ao resolver os faltantes.

## x42 — 1 ação(ões)

Avaliação adicional: professional_ref prematuro, service_ref/selection expostos, pergunta de serviço repetida..

### Turno 1

USER

> Marca um corte pro Andrinho amanhã.

SECRETÁRIA

```text
NORMAL_REVIEW
op1. appointment.create — NEEDS_INPUT; falta: service_ref, professional_ref, time, selection
Qual serviço? Selecione uma opção real.
Informe somente op1: service_ref e professional_ref e time e selection.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 3.803 s; Luna 3.686 s; backend 0.022 s.

conversation_ref: a6b5328d-1009-4b95-a207-52e4bbd6c294; plan_ref: 1ff7c3af-7efd-4e8a-acf4-7bd1cec14ace; revisão: 2.

Draft refs:

```json
{
  "observed_1": "0f7d84f6-ff0f-477b-977e-fb45ecf102ba"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T1": 39.8920999999973,
  "T2": 3725.6589999999997,
  "T3": 3759.3801999999996,
  "T4": 3781.2347999999984,
  "T5": 3803.0905999999995
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| op1 | appointment.create | NEEDS_INPUT | service_ref, professional_ref, time, selection | — |

Grafo: [].

Grupos: [{"key":"group_1","actions":["op1"],"review":"NORMAL_REVIEW","status":"NEEDS_REVIEW"}].

### Turno 2

USER

> 10h.

SECRETÁRIA

```text
NORMAL_REVIEW
op1. appointment.create — NEEDS_INPUT; falta: service_ref, professional_ref, selection
Qual serviço? Selecione uma opção real.
Informe somente op1: service_ref e professional_ref e selection.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 2.338 s; Luna 2.235 s; backend 0.016 s.

conversation_ref: a6b5328d-1009-4b95-a207-52e4bbd6c294; plan_ref: 1ff7c3af-7efd-4e8a-acf4-7bd1cec14ace; revisão: 4.

Draft refs:

```json
{
  "observed_1": "0f7d84f6-ff0f-477b-977e-fb45ecf102ba"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T3": 2295.1007000000027,
  "T1": 37.0596000000005,
  "T2": 2271.9671000000017,
  "T4": 2311.4060000000027,
  "T5": 2338.2563999999984
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| op1 | appointment.create | NEEDS_INPUT | service_ref, professional_ref, selection | — |

Grafo: [].

Grupos: [{"key":"group_1","actions":["op1"],"review":"NORMAL_REVIEW","status":"NEEDS_REVIEW"}].

Mudanças nos campos de intenção: [{"key":"op1","fields":["time"]}]. Mesmo plano: true; mesmo grafo: true; mesmos draft_refs: true. Assessments/previews/fingerprint podem mudar legitimamente ao resolver os faltantes.

## x43 — 2 ação(ões)

Avaliação adicional: CAPABILITY_SUPPORTED.

### Turno 1

USER

> Agenda o Andrinho amanhã às 10h para Corte Completo e bloqueia a Tatiana amanhã das 14h às 15h.

SECRETÁRIA

```text
NORMAL_REVIEW
agendar_andrinho. appointment.create — READY_FOR_CONFIRMATION
NOVO AGENDAMENTO
Cliente: Andrinho
Serviço: Corte Completo
Profissional: Tatiana
Data: 2026-10-06
Horário: 10:00–10:45 (America/Sao_Paulo)
Preço: R$ 50,00
Use Confirmar para executar.
bloquear_tatiana. schedule.block — READY_FOR_CONFIRMATION
BLOQUEAR AGENDA
Tatiana
2026-10-06T14:00–2026-10-06T15:00 (America/Sao_Paulo)
0 agendamento(s) atingido(s), preservado(s).
Use Confirmar para executar.
Revise os grupos. Mutações exigem confirmação; leituras não autorizam escrita.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 5.945 s; Luna 5.724 s; backend 0.127 s.

conversation_ref: a503d2c0-aa94-4869-833a-ce33e8ace98d; plan_ref: e1bfbec6-717c-4c60-8be2-bda05a216e4a; revisão: 3.

Draft refs:

```json
{
  "observed_1": "f1c7f54c-d07b-4eb3-85c8-2cf2f6d72b7a",
  "observed_2": "aea58807-76cf-4d30-ae2a-0b9d44b65917"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T1": 32.88139999999839,
  "T2": 5756.951699999998,
  "T3": 5784.695099999997,
  "T4": 5912.045400000003,
  "T5": 5945.0677
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| agendar_andrinho | appointment.create | READY_FOR_CONFIRMATION | — | — |
| bloquear_tatiana | schedule.block | READY_FOR_CONFIRMATION | — | — |

Grafo: [].

Grupos: [{"key":"group_1","actions":["agendar_andrinho","bloquear_tatiana"],"review":"NORMAL_REVIEW","status":"READY_FOR_CONFIRMATION"}].

## x44 — 2 ação(ões)

Avaliação adicional: professional_ref prematuro apesar de a pergunta do adapter pedir somente serviço e horário..

### Turno 1

USER

> Agenda o Andrinho amanhã e bloqueia a Tatiana amanhã das 14h às 15h.

SECRETÁRIA

```text
NORMAL_REVIEW
agenda_andrinho. appointment.create — NEEDS_INPUT; falta: service_ref, professional_ref, time
Informe serviço e horário exato.
bloqueio_tatiana. schedule.block — READY_FOR_CONFIRMATION
BLOQUEAR AGENDA
Tatiana
2026-10-06T14:00–2026-10-06T15:00 (America/Sao_Paulo)
0 agendamento(s) atingido(s), preservado(s).
Use Confirmar para executar.
Informe somente agenda_andrinho: service_ref e professional_ref e time.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 8.433 s; Luna 8.280 s; backend 0.053 s.

conversation_ref: 282d9d35-9910-4190-a91b-8a6102e0a0fc; plan_ref: 938c217e-9bf6-472b-8038-bb028d8bc320; revisão: 3.

Draft refs:

```json
{
  "observed_1": "bca5d88f-ba44-4b36-a20a-30ba82843884",
  "observed_2": "29feb99c-f95e-44d9-b22f-91b080ac852f"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T1": 31.278599999997823,
  "T2": 8311.527500000004,
  "T3": 8344.7379,
  "T4": 8398.0426,
  "T5": 8433.267899999999
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| agenda_andrinho | appointment.create | NEEDS_INPUT | service_ref, professional_ref, time | — |
| bloqueio_tatiana | schedule.block | READY_FOR_CONFIRMATION | — | — |

Grafo: [].

Grupos: [{"key":"group_1","actions":["agenda_andrinho","bloqueio_tatiana"],"review":"NORMAL_REVIEW","status":"NEEDS_REVIEW"}].

### Turno 2

USER

> Corte Completo às 10h.

SECRETÁRIA

```text
NORMAL_REVIEW
agenda_andrinho. appointment.create — READY_FOR_CONFIRMATION
NOVO AGENDAMENTO
Cliente: Andrinho
Serviço: Corte Completo
Profissional: Tatiana
Data: 2026-10-06
Horário: 10:00–10:45 (America/Sao_Paulo)
Preço: R$ 50,00
Use Confirmar para executar.
bloqueio_tatiana. schedule.block — READY_FOR_CONFIRMATION
BLOQUEAR AGENDA
Tatiana
2026-10-06T14:00–2026-10-06T15:00 (America/Sao_Paulo)
0 agendamento(s) atingido(s), preservado(s).
Use Confirmar para executar.
Revise os grupos. Mutações exigem confirmação; leituras não autorizam escrita.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 2.526 s; Luna 2.347 s; backend 0.095 s.

conversation_ref: 282d9d35-9910-4190-a91b-8a6102e0a0fc; plan_ref: 938c217e-9bf6-472b-8038-bb028d8bc320; revisão: 5.

Draft refs:

```json
{
  "observed_1": "bca5d88f-ba44-4b36-a20a-30ba82843884",
  "observed_2": "29feb99c-f95e-44d9-b22f-91b080ac852f"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T3": 2405.778100000003,
  "T1": 35.66290000000299,
  "T2": 2382.1789000000063,
  "T4": 2500.7229000000007,
  "T5": 2525.9729000000007
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| agenda_andrinho | appointment.create | READY_FOR_CONFIRMATION | — | — |
| bloqueio_tatiana | schedule.block | READY_FOR_CONFIRMATION | — | — |

Grafo: [].

Grupos: [{"key":"group_1","actions":["agenda_andrinho","bloqueio_tatiana"],"review":"NORMAL_REVIEW","status":"READY_FOR_CONFIRMATION"}].

Mudanças nos campos de intenção: [{"key":"agenda_andrinho","fields":["service_name","time"]}]. Mesmo plano: true; mesmo grafo: true; mesmos draft_refs: true. Assessments/previews/fingerprint podem mudar legitimamente ao resolver os faltantes.

## x45 — 5 ação(ões)

Avaliação adicional: CAPABILITY_SUPPORTED.

### Turno 1

USER

> Cancela Amanda Souza amanhã às 10h por pedido dela, coloca Fábio Santos no lugar para Corte Completo, avisa Amanda Souza no WhatsApp exatamente "Seu horário foi cancelado.", altera a Massagem para R$80 e me fala quanto faturei ontem.

SECRETÁRIA

```text
NORMAL_REVIEW
cancel_amanda. appointment.cancel — READY_FOR_CONFIRMATION
ALTERAÇÕES NA AGENDA
1. CANCELAR: Amanda Souza — Corte Completo
2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
Motivo: a pedido dela
Fila ativa: 0, preservada sem promoção.
2. AGENDAR: Fábio Santos — Corte Completo
Tatiana — 2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
R$ 50,00
A ação 2 depende do horário liberado pela ação 1. Tudo será aplicado na mesma transação.
create_fabio. appointment.create — READY_FOR_CONFIRMATION; depende de cancel_amanda
ALTERAÇÕES NA AGENDA
1. CANCELAR: Amanda Souza — Corte Completo
2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
Motivo: a pedido dela
Fila ativa: 0, preservada sem promoção.
2. AGENDAR: Fábio Santos — Corte Completo
Tatiana — 2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
R$ 50,00
A ação 2 depende do horário liberado pela ação 1. Tudo será aplicado na mesma transação.
message_amanda. customer.message — READY_FOR_CONFIRMATION; depende de cancel_amanda
MENSAGEM — SIMULAÇÃO LOCAL
Para: Amanda Souza ((11) *****-4321)
Canal: WhatsApp (fake, sem envio externo)
Mensagem:
Seu horário foi cancelado.
change_massage. service.change — READY_FOR_CONFIRMATION
Vou alterar:
Nome: Massagem (sem alteração)
Preço: R$ 100,00 → R$ 80,00
Duração: 60 minutos (sem alteração)
Demais campos e relações preservados.
Use Confirmar para executar esta proposta.
financial_yesterday. financial.report — DONE
Período: 2026-10-04 até 2026-10-05 (fim exclusivo), America/Sao_Paulo.
Consultado em 2026-10-05T12:00:00.000Z.
Faturamento bruto de serviços de atendimentos concluídos, pela data do atendimento (dashboard); antes de ajustes do fechamento.
R$ 120,00
Revise os grupos. Mutações exigem confirmação; leituras não autorizam escrita.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 9.651 s; Luna 9.352 s; backend 0.189 s.

conversation_ref: 38bc528a-1fa1-4cfb-b635-300fecda02af; plan_ref: 265df658-fab3-4fe8-979d-46fb3b5031ef; revisão: 6.

Draft refs:

```json
{
  "cancel_amanda": "6eba7aba-0386-42d1-aa31-db8bcab25a43",
  "create_fabio": "6eba7aba-0386-42d1-aa31-db8bcab25a43",
  "observed_2": "735e6621-1e90-4349-87dc-a2bb9ee42fc3",
  "observed_4": "835d244a-cefb-48e0-bdc5-97467ff82152"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T1": 33.388200000001234,
  "T2": 9385.193899999998,
  "T3": 9428.600599999998,
  "T4": 9617.991000000002,
  "T5": 9650.768600000003
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| cancel_amanda | appointment.cancel | READY_FOR_CONFIRMATION | — | — |
| create_fabio | appointment.create | READY_FOR_CONFIRMATION | — | cancel_amanda |
| message_amanda | customer.message | READY_FOR_CONFIRMATION | — | cancel_amanda |
| change_massage | service.change | READY_FOR_CONFIRMATION | — | — |
| financial_yesterday | financial.report | DONE | — | — |

Grafo: [{"from":"cancel_amanda","to":"create_fabio"},{"from":"cancel_amanda","to":"message_amanda"}].

Grupos: [{"key":"group_1","actions":["cancel_amanda","create_fabio","message_amanda","change_massage","financial_yesterday"],"review":"NORMAL_REVIEW","status":"READY_FOR_CONFIRMATION"}].

## x46 — 5 ação(ões)

Avaliação adicional: Pergunta de serviço repetida no cancelamento e no create; repetida ainda no rodapé..

### Turno 1

USER

> Cancela Amanda Souza amanhã às 10h por pedido dela, coloca Fábio Santos no lugar, avisa Amanda Souza no WhatsApp exatamente "Seu horário foi cancelado.", altera a Massagem para R$80 e me fala quanto faturei ontem.

SECRETÁRIA

```text
NORMAL_REVIEW
cancel_amanda. appointment.cancel — READY
Qual é o serviço do novo agendamento?
create_fabio. appointment.create — NEEDS_INPUT; depende de cancel_amanda; falta: service_name
Qual é o serviço do novo agendamento?
message_amanda. customer.message — READY_FOR_CONFIRMATION; depende de cancel_amanda
MENSAGEM — SIMULAÇÃO LOCAL
Para: Amanda Souza ((11) *****-4321)
Canal: WhatsApp (fake, sem envio externo)
Mensagem:
Seu horário foi cancelado.
change_massagem. service.change — READY_FOR_CONFIRMATION
Vou alterar:
Nome: Massagem (sem alteração)
Preço: R$ 100,00 → R$ 80,00
Duração: 60 minutos (sem alteração)
Demais campos e relações preservados.
Use Confirmar para executar esta proposta.
revenue_yesterday. financial.report — DONE
Período: 2026-10-04 até 2026-10-05 (fim exclusivo), America/Sao_Paulo.
Consultado em 2026-10-05T12:00:00.000Z.
Faturamento bruto de serviços de atendimentos concluídos, pela data do atendimento (dashboard); antes de ajustes do fechamento.
R$ 120,00
Informe somente create_fabio: service_name.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 10.493 s; Luna 10.272 s; backend 0.083 s.

conversation_ref: 58dcbbcb-9c54-4858-9e5e-b61f375c01e3; plan_ref: 7cee890a-4b5f-491f-91ee-84bbf8d9e74d; revisão: 6.

Draft refs:

```json
{
  "cancel_amanda": "d0e560a1-b9a4-406c-9712-35950bf70187",
  "create_fabio": "d0e560a1-b9a4-406c-9712-35950bf70187",
  "observed_2": "dc316574-ade8-442d-80b3-57049b8a13b7",
  "observed_4": "20ccaee1-2f21-4eb6-aeac-1e13b610abeb"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T1": 32.483100000004924,
  "T2": 10304.419199999997,
  "T3": 10368.120400000007,
  "T4": 10451.364999999998,
  "T5": 10492.596299999997
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| cancel_amanda | appointment.cancel | READY | — | — |
| create_fabio | appointment.create | NEEDS_INPUT | service_name | cancel_amanda |
| message_amanda | customer.message | READY_FOR_CONFIRMATION | — | cancel_amanda |
| change_massagem | service.change | READY_FOR_CONFIRMATION | — | — |
| revenue_yesterday | financial.report | DONE | — | — |

Grafo: [{"from":"cancel_amanda","to":"create_fabio"},{"from":"cancel_amanda","to":"message_amanda"}].

Grupos: [{"key":"group_1","actions":["cancel_amanda","create_fabio","message_amanda","change_massagem","revenue_yesterday"],"review":"NORMAL_REVIEW","status":"NEEDS_REVIEW"}].

### Turno 2

USER

> Corte Completo.

SECRETÁRIA

```text
NORMAL_REVIEW
cancel_amanda. appointment.cancel — READY_FOR_CONFIRMATION
ALTERAÇÕES NA AGENDA
1. CANCELAR: Amanda Souza — Corte Completo
2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
Motivo: a pedido dela
Fila ativa: 0, preservada sem promoção.
2. AGENDAR: Fábio Santos — Corte Completo
Tatiana — 2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
R$ 50,00
A ação 2 depende do horário liberado pela ação 1. Tudo será aplicado na mesma transação.
create_fabio. appointment.create — READY_FOR_CONFIRMATION; depende de cancel_amanda
ALTERAÇÕES NA AGENDA
1. CANCELAR: Amanda Souza — Corte Completo
2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
Motivo: a pedido dela
Fila ativa: 0, preservada sem promoção.
2. AGENDAR: Fábio Santos — Corte Completo
Tatiana — 2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
R$ 50,00
A ação 2 depende do horário liberado pela ação 1. Tudo será aplicado na mesma transação.
message_amanda. customer.message — READY_FOR_CONFIRMATION; depende de cancel_amanda
MENSAGEM — SIMULAÇÃO LOCAL
Para: Amanda Souza ((11) *****-4321)
Canal: WhatsApp (fake, sem envio externo)
Mensagem:
Seu horário foi cancelado.
change_massagem. service.change — READY_FOR_CONFIRMATION
Vou alterar:
Nome: Massagem (sem alteração)
Preço: R$ 100,00 → R$ 80,00
Duração: 60 minutos (sem alteração)
Demais campos e relações preservados.
Use Confirmar para executar esta proposta.
revenue_yesterday. financial.report — DONE
Período: 2026-10-04 até 2026-10-05 (fim exclusivo), America/Sao_Paulo.
Consultado em 2026-10-05T12:00:00.000Z.
Faturamento bruto de serviços de atendimentos concluídos, pela data do atendimento (dashboard); antes de ajustes do fechamento.
R$ 120,00
Revise os grupos. Mutações exigem confirmação; leituras não autorizam escrita.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 2.417 s; Luna 2.206 s; backend 0.105 s.

conversation_ref: 58dcbbcb-9c54-4858-9e5e-b61f375c01e3; plan_ref: 7cee890a-4b5f-491f-91ee-84bbf8d9e74d; revisão: 9.

Draft refs:

```json
{
  "cancel_amanda": "d0e560a1-b9a4-406c-9712-35950bf70187",
  "create_fabio": "d0e560a1-b9a4-406c-9712-35950bf70187",
  "observed_2": "dc316574-ade8-442d-80b3-57049b8a13b7",
  "observed_4": "20ccaee1-2f21-4eb6-aeac-1e13b610abeb"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T3": 2284.241599999994,
  "T1": 45.1877999999997,
  "T2": 2251.0935000000027,
  "T4": 2389.6601999999984,
  "T5": 2417.086200000005
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| cancel_amanda | appointment.cancel | READY_FOR_CONFIRMATION | — | — |
| create_fabio | appointment.create | READY_FOR_CONFIRMATION | — | cancel_amanda |
| message_amanda | customer.message | READY_FOR_CONFIRMATION | — | cancel_amanda |
| change_massagem | service.change | READY_FOR_CONFIRMATION | — | — |
| revenue_yesterday | financial.report | DONE | — | — |

Grafo: [{"from":"cancel_amanda","to":"create_fabio"},{"from":"cancel_amanda","to":"message_amanda"}].

Grupos: [{"key":"group_1","actions":["cancel_amanda","create_fabio","message_amanda","change_massagem","revenue_yesterday"],"review":"NORMAL_REVIEW","status":"READY_FOR_CONFIRMATION"}].

Mudanças nos campos de intenção: [{"key":"create_fabio","fields":["service_name"]}]. Mesmo plano: true; mesmo grafo: true; mesmos draft_refs: true. Assessments/previews/fingerprint podem mudar legitimamente ao resolver os faltantes.

## x47 — 5 ação(ões)

Avaliação adicional: CAPABILITY_SUPPORTED.

### Turno 1

USER

> Cancela Amanda Souza amanhã às 10h por pedido dela, coloca Fábio Santos no lugar para Corte Completo, avisa Amanda Souza no WhatsApp exatamente "Seu horário foi cancelado.", altera a Massagem para R$80 e me fala quanto faturei ontem.

SECRETÁRIA

```text
NORMAL_REVIEW
cancel_amanda. appointment.cancel — DOMAIN_CONFLICT; DOMAIN_CONFLICT
Plano bloqueado: SLOT_CONFLICT. Nenhuma ação executada.
create_fabio. appointment.create — BLOCKED_BY_DEPENDENCY; depende de cancel_amanda; DOMAIN_CONFLICT
Plano bloqueado: SLOT_CONFLICT. Nenhuma ação executada.
message_amanda. customer.message — BLOCKED_BY_DEPENDENCY; depende de cancel_amanda
MENSAGEM — SIMULAÇÃO LOCAL
Para: Amanda Souza ((11) *****-4321)
Canal: WhatsApp (fake, sem envio externo)
Mensagem:
Seu horário foi cancelado.
change_massagem. service.change — READY_FOR_CONFIRMATION
Vou alterar:
Nome: Massagem (sem alteração)
Preço: R$ 100,00 → R$ 80,00
Duração: 60 minutos (sem alteração)
Demais campos e relações preservados.
Use Confirmar para executar esta proposta.
financial_yesterday. financial.report — DONE
Período: 2026-10-04 até 2026-10-05 (fim exclusivo), America/Sao_Paulo.
Consultado em 2026-10-05T12:00:00.000Z.
Faturamento bruto de serviços de atendimentos concluídos, pela data do atendimento (dashboard); antes de ajustes do fechamento.
R$ 120,00
Revise os grupos. Mutações exigem confirmação; leituras não autorizam escrita.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 8.955 s; Luna 8.720 s; backend 0.111 s.

conversation_ref: 69332102-04ef-43e4-a2b2-b1810accc67f; plan_ref: a274c279-deb7-4049-8944-79ac48fb2d4d; revisão: 6.

Draft refs:

```json
{
  "cancel_amanda": "eafa0208-1818-431b-a199-f99c1b2c6329",
  "create_fabio": "eafa0208-1818-431b-a199-f99c1b2c6329",
  "observed_2": "058e6cd4-2eaf-4b2c-8c53-14b49d6d1948",
  "observed_4": "5c445b40-1c6c-4d13-8a55-3561218645b3"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T1": 34.456099999995786,
  "T2": 8754.109599999996,
  "T3": 8797.707599999994,
  "T4": 8908.214200000002,
  "T5": 8954.709499999997
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| cancel_amanda | appointment.cancel | DOMAIN_CONFLICT | — | — |
| create_fabio | appointment.create | BLOCKED_BY_DEPENDENCY | — | cancel_amanda |
| message_amanda | customer.message | BLOCKED_BY_DEPENDENCY | — | cancel_amanda |
| change_massagem | service.change | READY_FOR_CONFIRMATION | — | — |
| financial_yesterday | financial.report | DONE | — | — |

Grafo: [{"from":"cancel_amanda","to":"create_fabio"},{"from":"cancel_amanda","to":"message_amanda"}].

Grupos: [{"key":"group_1","actions":["cancel_amanda","create_fabio","message_amanda","change_massagem","financial_yesterday"],"review":"NORMAL_REVIEW","status":"NEEDS_REVIEW"}].

## x48 — 10 ação(ões)

Avaliação adicional: CAPABILITY_SUPPORTED.

### Turno 1

USER

> Cancela Amanda Souza amanhã às 10h por pedido dela, coloca Fábio Santos no lugar para Corte Completo, avisa Amanda Souza no WhatsApp exatamente "Seu horário foi cancelado.", altera a Massagem para R$80 e me fala quanto faturei ontem. Também cadastra Lia Santos como cliente, dá entrada em 10 unidades de Shampoo X, bloqueia Tatiana amanhã das 14h às 15h, mostra os produtos com estoque baixo e cadastra Barba Expressa por R$35 com duração de 20 minutos.

SECRETÁRIA

```text
ADVANCED_REVIEW
cancel_amanda. appointment.cancel — READY_FOR_CONFIRMATION
ALTERAÇÕES NA AGENDA
1. CANCELAR: Amanda Souza — Corte Completo
2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
Motivo: A pedido dela
Fila ativa: 0, preservada sem promoção.
2. AGENDAR: Fábio Santos — Corte Completo
Tatiana — 2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
R$ 50,00
A ação 2 depende do horário liberado pela ação 1. Tudo será aplicado na mesma transação.
create_fabio. appointment.create — READY_FOR_CONFIRMATION; depende de cancel_amanda
ALTERAÇÕES NA AGENDA
1. CANCELAR: Amanda Souza — Corte Completo
2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
Motivo: A pedido dela
Fila ativa: 0, preservada sem promoção.
2. AGENDAR: Fábio Santos — Corte Completo
Tatiana — 2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
R$ 50,00
A ação 2 depende do horário liberado pela ação 1. Tudo será aplicado na mesma transação.
message_amanda. customer.message — READY_FOR_CONFIRMATION; depende de cancel_amanda
MENSAGEM — SIMULAÇÃO LOCAL
Para: Amanda Souza ((11) *****-4321)
Canal: WhatsApp (fake, sem envio externo)
Mensagem:
Seu horário foi cancelado.
change_massagem. service.change — READY_FOR_CONFIRMATION
Vou alterar:
Nome: Massagem (sem alteração)
Preço: R$ 100,00 → R$ 80,00
Duração: 60 minutos (sem alteração)
Demais campos e relações preservados.
Use Confirmar para executar esta proposta.
financial_yesterday. financial.report — DONE
Período: 2026-10-04 até 2026-10-05 (fim exclusivo), America/Sao_Paulo.
Consultado em 2026-10-05T12:00:00.000Z.
Faturamento bruto de serviços de atendimentos concluídos, pela data do atendimento (dashboard); antes de ajustes do fechamento.
R$ 120,00
create_lia. customer.create — READY_FOR_CONFIRMATION
Confira o cadastro do cliente:
Nome: Lia Santos
Telefone: Não informado
E-mail: Não informado
Use Confirmar para executar.
stock_shampoo. stock.movement — READY_FOR_CONFIRMATION
ENTRADA DE ESTOQUE
Shampoo X
Atual: 4 un
Movimento: +10 un
Projetado: 14 un
Motivo: Ajuste rápido
Use Confirmar para movimentar o estoque.
block_tatiana. schedule.block — READY_FOR_CONFIRMATION
BLOQUEAR AGENDA
Tatiana
2026-10-06T14:00–2026-10-06T15:00 (America/Sao_Paulo)
0 agendamento(s) atingido(s), preservado(s).
Use Confirmar para executar.
search_low_stock. product.search — DONE
Estoque baixo (saldo ≤ mínimo):
Shampoo X: 4 un; mínimo 5 un
create_barba. service.create — READY_FOR_CONFIRMATION
Vou cadastrar:
Barba Expressa
R$ 35,00
20 minutos
Sem categoria e sem profissional vinculado.
Padrões existentes: preço fixo; ativo; custo R$ 0,00; processamento e finalização 0 min; sem variante ou recurso físico; descrição, imagem e cor não informadas.
Use Confirmar para executar esta proposta.
Revise os grupos. Mutações exigem confirmação; leituras não autorizam escrita.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 18.955 s; Luna 18.529 s; backend 0.247 s.

conversation_ref: 4b2e5f40-bf0f-479c-b929-612d422cf83a; plan_ref: 78759d1a-996e-4ed5-8753-abff68b88d3b; revisão: 11.

Draft refs:

```json
{
  "cancel_amanda": "19ea275a-d8ce-4b27-954d-b23125ae2c91",
  "create_fabio": "19ea275a-d8ce-4b27-954d-b23125ae2c91",
  "observed_2": "fca162bf-46ce-4041-9b5a-7b6a14939eba",
  "observed_4": "c71d105d-c96d-4886-93e7-101b21d9ad3a",
  "observed_5": "3a996ba5-e8ed-49d3-93d4-a678354b12a8",
  "observed_6": "cccb6f5e-0d91-45ec-93cf-37e9e6af070f",
  "observed_8": "c99dc55d-87c3-4b44-af31-dee15ef0bb21",
  "observed_9": "c0a3c6cf-fee3-4651-822b-67ece34fd76b"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T1": 33.18859999999404,
  "T2": 18562.178400000004,
  "T3": 18616.791400000002,
  "T4": 18863.989199999996,
  "T5": 18954.699600000007
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| cancel_amanda | appointment.cancel | READY_FOR_CONFIRMATION | — | — |
| create_fabio | appointment.create | READY_FOR_CONFIRMATION | — | cancel_amanda |
| message_amanda | customer.message | READY_FOR_CONFIRMATION | — | cancel_amanda |
| change_massagem | service.change | READY_FOR_CONFIRMATION | — | — |
| financial_yesterday | financial.report | DONE | — | — |
| create_lia | customer.create | READY_FOR_CONFIRMATION | — | — |
| stock_shampoo | stock.movement | READY_FOR_CONFIRMATION | — | — |
| block_tatiana | schedule.block | READY_FOR_CONFIRMATION | — | — |
| search_low_stock | product.search | DONE | — | — |
| create_barba | service.create | READY_FOR_CONFIRMATION | — | — |

Grafo: [{"from":"cancel_amanda","to":"create_fabio"},{"from":"cancel_amanda","to":"message_amanda"}].

Grupos: [{"key":"group_1","actions":["cancel_amanda","create_fabio","message_amanda","change_massagem","financial_yesterday","create_lia","stock_shampoo","block_tatiana","search_low_stock","create_barba"],"review":"ADVANCED_REVIEW","status":"READY_FOR_CONFIRMATION"}].

## x49 — 10 ação(ões)

Avaliação adicional: Pergunta de serviço repetida; service_name/end_time expostos no rodapé..

### Turno 1

USER

> Cancela Amanda Souza amanhã às 10h por pedido dela, coloca Fábio Santos no lugar, avisa Amanda Souza no WhatsApp exatamente "Seu horário foi cancelado.", altera a Massagem para R$80 e me fala quanto faturei ontem. Também cadastra Lia Santos como cliente, dá entrada em 10 unidades de Shampoo X, bloqueia Tatiana amanhã das 14h, mostra os produtos com estoque baixo e cadastra Barba Expressa por R$35 com duração de 20 minutos.

SECRETÁRIA

```text
ADVANCED_REVIEW
cancel_amanda. appointment.cancel — READY
Qual é o serviço do novo agendamento?
create_fabio. appointment.create — NEEDS_INPUT; depende de cancel_amanda; falta: service_name
Qual é o serviço do novo agendamento?
message_amanda. customer.message — READY_FOR_CONFIRMATION; depende de cancel_amanda
MENSAGEM — SIMULAÇÃO LOCAL
Para: Amanda Souza ((11) *****-4321)
Canal: WhatsApp (fake, sem envio externo)
Mensagem:
Seu horário foi cancelado.
change_massage. service.change — READY_FOR_CONFIRMATION
Vou alterar:
Nome: Massagem (sem alteração)
Preço: R$ 100,00 → R$ 80,00
Duração: 60 minutos (sem alteração)
Demais campos e relações preservados.
Use Confirmar para executar esta proposta.
revenue_yesterday. financial.report — DONE
Período: 2026-10-04 até 2026-10-05 (fim exclusivo), America/Sao_Paulo.
Consultado em 2026-10-05T12:00:00.000Z.
Faturamento bruto de serviços de atendimentos concluídos, pela data do atendimento (dashboard); antes de ajustes do fechamento.
R$ 120,00
create_lia. customer.create — READY_FOR_CONFIRMATION
Confira o cadastro do cliente:
Nome: Lia Santos
Telefone: Não informado
E-mail: Não informado
Use Confirmar para executar.
stock_in_shampoo. stock.movement — READY_FOR_CONFIRMATION
ENTRADA DE ESTOQUE
Shampoo X
Atual: 4 un
Movimento: +10 un
Projetado: 14 un
Motivo: Ajuste rápido
Use Confirmar para movimentar o estoque.
low_stock_products. product.search — DONE
Estoque baixo (saldo ≤ mínimo):
Shampoo X: 4 un; mínimo 5 un
block_tatiana. schedule.block — NEEDS_INPUT; falta: end_time
Informe horário final.
create_barba. service.create — READY_FOR_CONFIRMATION
Vou cadastrar:
Barba Expressa
R$ 35,00
20 minutos
Sem categoria e sem profissional vinculado.
Padrões existentes: preço fixo; ativo; custo R$ 0,00; processamento e finalização 0 min; sem variante ou recurso físico; descrição, imagem e cor não informadas.
Use Confirmar para executar esta proposta.
Informe somente create_fabio: service_name; block_tatiana: end_time.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 16.188 s; Luna 15.921 s; backend 0.145 s.

conversation_ref: 4084ed75-985e-4bbc-bfaa-a82cc1a14cd5; plan_ref: 730396c0-bffd-4aad-8a23-c08cb6716f88; revisão: 11.

Draft refs:

```json
{
  "cancel_amanda": "fcc6e1d5-c0d0-4682-839a-fec78352d956",
  "create_fabio": "fcc6e1d5-c0d0-4682-839a-fec78352d956",
  "observed_2": "be7945fb-adb9-4030-9415-c8d926bfa38e",
  "observed_4": "cfdf8fdd-ef3a-493c-b3fe-2208322e5da4",
  "observed_5": "51350bc6-987b-42ea-a784-f5c2f1389ad2",
  "observed_7": "5df099dc-a9a2-4be1-b443-3bacab1e1416",
  "observed_8": "1b75ba15-ab79-4eb9-ba91-cb4364cd6f0c",
  "observed_9": "5946c793-ef7d-4d77-a9d9-c7db959e9686"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T1": 34.630400000009104,
  "T2": 15955.838400000008,
  "T3": 16004.821800000005,
  "T4": 16149.370500000005,
  "T5": 16188.3324
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| cancel_amanda | appointment.cancel | READY | — | — |
| create_fabio | appointment.create | NEEDS_INPUT | service_name | cancel_amanda |
| message_amanda | customer.message | READY_FOR_CONFIRMATION | — | cancel_amanda |
| change_massage | service.change | READY_FOR_CONFIRMATION | — | — |
| revenue_yesterday | financial.report | DONE | — | — |
| create_lia | customer.create | READY_FOR_CONFIRMATION | — | — |
| stock_in_shampoo | stock.movement | READY_FOR_CONFIRMATION | — | — |
| low_stock_products | product.search | DONE | — | — |
| block_tatiana | schedule.block | NEEDS_INPUT | end_time | — |
| create_barba | service.create | READY_FOR_CONFIRMATION | — | — |

Grafo: [{"from":"cancel_amanda","to":"create_fabio"},{"from":"cancel_amanda","to":"message_amanda"}].

Grupos: [{"key":"group_1","actions":["cancel_amanda","create_fabio","message_amanda","change_massage","revenue_yesterday","create_lia","stock_in_shampoo","low_stock_products","block_tatiana","create_barba"],"review":"ADVANCED_REVIEW","status":"NEEDS_REVIEW"}].

### Turno 2

USER

> Corte Completo para o Fábio e bloqueia até 16h.

SECRETÁRIA

```text
ADVANCED_REVIEW
cancel_amanda. appointment.cancel — READY_FOR_CONFIRMATION
ALTERAÇÕES NA AGENDA
1. CANCELAR: Amanda Souza — Corte Completo
2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
Motivo: por pedido dela
Fila ativa: 0, preservada sem promoção.
2. AGENDAR: Fábio Santos — Corte Completo
Tatiana — 2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
R$ 50,00
A ação 2 depende do horário liberado pela ação 1. Tudo será aplicado na mesma transação.
create_fabio. appointment.create — READY_FOR_CONFIRMATION; depende de cancel_amanda
ALTERAÇÕES NA AGENDA
1. CANCELAR: Amanda Souza — Corte Completo
2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
Motivo: por pedido dela
Fila ativa: 0, preservada sem promoção.
2. AGENDAR: Fábio Santos — Corte Completo
Tatiana — 2026-10-06T10:00–2026-10-06T10:45 (America/Sao_Paulo)
R$ 50,00
A ação 2 depende do horário liberado pela ação 1. Tudo será aplicado na mesma transação.
message_amanda. customer.message — READY_FOR_CONFIRMATION; depende de cancel_amanda
MENSAGEM — SIMULAÇÃO LOCAL
Para: Amanda Souza ((11) *****-4321)
Canal: WhatsApp (fake, sem envio externo)
Mensagem:
Seu horário foi cancelado.
change_massage. service.change — READY_FOR_CONFIRMATION
Vou alterar:
Nome: Massagem (sem alteração)
Preço: R$ 100,00 → R$ 80,00
Duração: 60 minutos (sem alteração)
Demais campos e relações preservados.
Use Confirmar para executar esta proposta.
revenue_yesterday. financial.report — DONE
Período: 2026-10-04 até 2026-10-05 (fim exclusivo), America/Sao_Paulo.
Consultado em 2026-10-05T12:00:00.000Z.
Faturamento bruto de serviços de atendimentos concluídos, pela data do atendimento (dashboard); antes de ajustes do fechamento.
R$ 120,00
create_lia. customer.create — READY_FOR_CONFIRMATION
Confira o cadastro do cliente:
Nome: Lia Santos
Telefone: Não informado
E-mail: Não informado
Use Confirmar para executar.
stock_in_shampoo. stock.movement — READY_FOR_CONFIRMATION
ENTRADA DE ESTOQUE
Shampoo X
Atual: 4 un
Movimento: +10 un
Projetado: 14 un
Motivo: Ajuste rápido
Use Confirmar para movimentar o estoque.
low_stock_products. product.search — DONE
Estoque baixo (saldo ≤ mínimo):
Shampoo X: 4 un; mínimo 5 un
block_tatiana. schedule.block — READY_FOR_CONFIRMATION
BLOQUEAR AGENDA
Tatiana
2026-10-06T14:00–2026-10-06T16:00 (America/Sao_Paulo)
0 agendamento(s) atingido(s), preservado(s).
Use Confirmar para executar.
create_barba. service.create — READY_FOR_CONFIRMATION
Vou cadastrar:
Barba Expressa
R$ 35,00
20 minutos
Sem categoria e sem profissional vinculado.
Padrões existentes: preço fixo; ativo; custo R$ 0,00; processamento e finalização 0 min; sem variante ou recurso físico; descrição, imagem e cor não informadas.
Use Confirmar para executar esta proposta.
Revise os grupos. Mutações exigem confirmação; leituras não autorizam escrita.
Ações independentes podem concluir mesmo se outra falhar. Dependentes só executam após os pré-requisitos; pares atômicos mantêm a transação conjunta.
```

E2E 4.738 s; Luna 4.501 s; backend 0.124 s.

conversation_ref: 4084ed75-985e-4bbc-bfaa-a82cc1a14cd5; plan_ref: 730396c0-bffd-4aad-8a23-c08cb6716f88; revisão: 15.

Draft refs:

```json
{
  "cancel_amanda": "fcc6e1d5-c0d0-4682-839a-fec78352d956",
  "create_fabio": "fcc6e1d5-c0d0-4682-839a-fec78352d956",
  "observed_2": "be7945fb-adb9-4030-9415-c8d926bfa38e",
  "observed_4": "cfdf8fdd-ef3a-493c-b3fe-2208322e5da4",
  "observed_5": "51350bc6-987b-42ea-a784-f5c2f1389ad2",
  "observed_7": "5df099dc-a9a2-4be1-b443-3bacab1e1416",
  "observed_8": "1b75ba15-ab79-4eb9-ba91-cb4364cd6f0c",
  "observed_9": "5946c793-ef7d-4d77-a9d9-c7db959e9686"
}
```

T0–T5 relativos, ms:

```json
{
  "T0": 0,
  "T3": 4580.1829,
  "T1": 49.232399999993504,
  "T2": 4549.743399999992,
  "T4": 4704.314700000003,
  "T5": 4737.973899999997
}
```

| Key | Operation | Status | Faltantes | Depende de |
| --- | --- | --- | --- | --- |
| cancel_amanda | appointment.cancel | READY_FOR_CONFIRMATION | — | — |
| create_fabio | appointment.create | READY_FOR_CONFIRMATION | — | cancel_amanda |
| message_amanda | customer.message | READY_FOR_CONFIRMATION | — | cancel_amanda |
| change_massage | service.change | READY_FOR_CONFIRMATION | — | — |
| revenue_yesterday | financial.report | DONE | — | — |
| create_lia | customer.create | READY_FOR_CONFIRMATION | — | — |
| stock_in_shampoo | stock.movement | READY_FOR_CONFIRMATION | — | — |
| low_stock_products | product.search | DONE | — | — |
| block_tatiana | schedule.block | READY_FOR_CONFIRMATION | — | — |
| create_barba | service.create | READY_FOR_CONFIRMATION | — | — |

Grafo: [{"from":"cancel_amanda","to":"create_fabio"},{"from":"cancel_amanda","to":"message_amanda"}].

Grupos: [{"key":"group_1","actions":["cancel_amanda","create_fabio","message_amanda","change_massage","revenue_yesterday","create_lia","stock_in_shampoo","low_stock_products","block_tatiana","create_barba"],"review":"ADVANCED_REVIEW","status":"READY_FOR_CONFIRMATION"}].

Mudanças nos campos de intenção: [{"key":"create_fabio","fields":["service_name"]},{"key":"block_tatiana","fields":["end_time"]}]. Mesmo plano: true; mesmo grafo: true; mesmos draft_refs: true. Assessments/previews/fingerprint podem mudar legitimamente ao resolver os faltantes.
