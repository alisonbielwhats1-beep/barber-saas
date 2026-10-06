# Gate 4.0B.3.2 — Phase A continuation i02–i26

O modo de continuação foi preparado **somente no harness de avaliação**. Não
altera a Secretária, Registry, Skills, Tools, fast-path, Router, prompts,
fixtures, expected ou banco. Nenhuma inferência OpenAI/JEV, confirmação ou
operação de negócio ocorreu neste Gate. `i01` permanece PASS histórico e não
faz parte da continuação.

## Artefatos congelados

| Artefato | SHA-256 |
| --- | --- |
| Phase A original, 26 casos/28 turnos | `11f3ea7f8e04d5ccca7723b9f3575bde3a275e332f744453f63568b4b2dabbaa` |
| Continuação, 25 casos/27 turnos | `25fabe2e60163bc61764bbeabf8d5fad3a5bcd2cca008d5377ddc54374c63582` |
| Baseline de auditoria/operações | `c66c6307b2877a61b8a74b50a206132671a80026940f40d996789ee0699398a8` |
| Resultado sanitizado da revalidação i01 | `069dab551c9e655988b5f17830ebd96b8f604d3cd25cef6ac3b388b5def0d33f` |
| Dump pré-i01 aprovado | `28c02b254017e4be377591898ec30e31e1405e22868d4de790597269bb6f6093` |
| Dump pós-i01 | `3f6cfe3f7b2a04aff99dcb06cbeacd00c43c7179668812295ada3d1f434aaaad` |

O manifest de continuação copia integralmente mensagens, turnos, categorias,
fixtures e expected dos 25 casos restantes, na ordem congelada. O verificador
compara o conteúdo completo com o Phase A original, confere todos os hashes
predecessores e bloqueia caso extra, ordem diferente ou qualquer ocorrência de
`i01`. A saída futura fica em arquivo próprio, sem sobrescrever o resultado de
`i01` nem o resultado da primeira tentativa da Phase A.

## Regra contextual do preflight

O preflight original continua exigindo zero AuditLog. **Somente**
`--preflight-continuation` aceita os sete logs aprovados de `i01`, após comparar
o SHA-256 de cada linha completa, ação, entityType, tenant, ator, status e
timestamp com a baseline congelada. São, em ordem:
`MODEL_CALL_STARTED`, `MODEL_CALL_FINISHED`, `SKILLS_LOADED`, `DRAFT`,
`SCHEDULING_TIMINGS`, `OPERATIONS_PREPARED`, `DIRECT_LUNA`. Os registros vão de
`2026-09-24T06:01:51.864Z` a `2026-09-24T06:01:58.933Z`. Onde o runtime expõe
referência de conversa ou draft, ela é comparada ao resultado aprovado; o log
de timings usa seu identificador próprio e é protegido pelo hash completo. O
usage final é `SUCCEEDED`, o plano contém somente `appointment.create` e o
Router registrou `DIRECT_LUNA`, sem JEV/retry. O total global de AuditLog deve
ser **exatamente sete**; um oitavo log, em qualquer tenant, bloqueia.

As outras 25 fixtures continuam exigindo zero AuditLog antes da bateria. Para
os 26 tenants, snapshots congelados de Services, Customers, Appointments,
AppointmentService/Event/Product, Products, Outbox, closures, time off,
resource bookings e Payments são comparados por hash e contagem. A baseline
operacional exige zero Outbox, confirmação e mudança; novos logs técnicos da
futura continuação serão medidos como delta a partir de sete, por tenant e por
turno. O preflight valida a role `mvp_service_runtime` sem SUPERUSER/BYPASSRLS,
19 tabelas com RLS/FORCE, fixtures e isolamento cruzado pelo runtime real.

Em 24/09/2026, `node scripts/run-hard-conversations-phase-a.cjs
--preflight-continuation` retornou `PHASE_A_CONTINUATION_PREFLIGHT_OK`,
25/25 casos, 27/27 turnos, sete logs históricos, zero chamadas de rede.

Os oito testes novos cobrem os sete logs exatos, oitavo log, adulteração,
escopo sem i01, 25/27, guarda antes do preflight, teto de 27 requests, baseline
operacional, Outbox e confirmação indevidos. Testes direcionados do
harness/bridge/diagnóstico: 54 aprovados; suíte geral: 2.263 aprovados.
`npm run lint`, `npx tsc --noEmit --incremental false` e `npm run build`
passaram. O build usou fonte simulada local, segredo sintético efêmero e rede
bloqueada; não testou inferência nem executou a continuação.

## Execução futura, ainda não autorizada neste Gate

`--continue-after-i01` exige `PHASE_A_CONTINUATION_I02_I26_APPROVED=true`
somente no processo controlado. A guarda existe no CLI e na função de execução;
a witness também bloqueia `i01` antes da rede. Há no máximo 27 requests Responses
GPT-6 Luna, zero JEV, zero retries e zero confirmações. A reserva conservadora
usa a tarifa já congelada no manifest (input US$0,10/M, cache write US$0,125/M,
output US$0,50/M, sem desconto de cache presumido): **US$0,0086 por request ×
27 = US$0,2322**. Essa é reserva, não cobrança; a tarifa oficial deve ser
reconfirmada antes de autorizar a bateria paga.

A witness mantém `POST /v1/responses`, `model=gpt-6-luna`, `store=false`,
`stream=false`, `parallel_tool_calls=false`, somente Function Tool local,
hosted tools e containers zerados, sem arquivos, segredos ou PII. A continuação
para em campo obrigatório inventado, entidade errada, proposta/execução
insegura, escrita operacional, confirmação, vazamento entre tenants, JEV,
wire/schema fora do guard ou orçamento excedido. O runner continua sem API de
confirmação. Paid calls e Router voltam a false em `finally`.

O comando futuro, **não executado aqui**, é:

```powershell
$env:PHASE_A_CONTINUATION_I02_I26_APPROVED='true'
try { node .\scripts\run-hard-conversations-phase-a.cjs --continue-after-i01 }
finally {
  $env:PHASE_A_CONTINUATION_I02_I26_APPROVED='false'
  $env:SALON_SECRETARY_ALLOW_PAID_CALLS='false'
  $env:SALON_SECRETARY_JEV_ROUTER_ENABLED='false'
}
```

Rollback de código: remover apenas o módulo/manifest/baseline de continuação,
o teste e este documento; reverter as extensões delimitadas do CLI, precheck,
execution e witness. Preservar os sete logs de i01, os dumps e os resultados
históricos. Nenhum rollback de banco é necessário para este Gate.
