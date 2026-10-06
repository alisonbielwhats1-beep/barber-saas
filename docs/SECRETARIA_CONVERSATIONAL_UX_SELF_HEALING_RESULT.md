# Conversational UX — canonical switch e validação controlada consolidada

24/09/2026, horário de São Paulo; journals em UTC de 25/09. Branch `codex/conversational-ux-microbattery`. **MINIMUM_CLARIFICATION_UX = NOT_VALIDATED.**

O baseline foi adotado e o preflight passou. Quatro casos têm PASS pela rubrica congelada; x49 não iniciou por orçamento. Foram consumidas **9/10 requests**, incluindo a tentativa original rejeitada de x44. Uma request restante não comporta os dois turnos congelados de x49. O teto financeiro de US$0,13 não foi atingido. Não houve pedido de nova autorização, retry cego, repetição de x41/x42, reseed, migration ou deploy.

| Caso | Benchmark anterior | Resultado original desta execução | Correção/revalidação | Duplicação / leak | Continuidade / DAG | Final pela rubrica |
| --- | --- | --- | --- | --- | --- | --- |
| x41 | Falha conversacional | PASS, 2 turnos | Não repetido | 0 / 0 | PASS / sem arestas | PASS* |
| x42 | Falha conversacional | PASS, 2 turnos | Não repetido; ambiguidade preservada | 0 / 0 | PASS / sem arestas | PASS |
| x44 | Falha conversacional | HTTP 200, item_key inválido; FUNCTIONAL_FAILURE_SAFE | CONTRACT_MISMATCH corrigido; única REVALIDATION_AFTER_FIX, 2 turnos PASS | 0 / 0 pós-fix | PASS / sem arestas | PASS* |
| x46 | Falha conversacional | NOT_STARTED | Primeira execução, 2 turnos PASS | 0 / 0 | PASS / cancel→create e cancel→message | PASS* |
| x49 | Falha conversacional | NOT_STARTED | Não admitido: faltam 2 requests, resta 1 | N/A | N/A | UNKNOWN |

**Placar final: PASS 4/5; FUNCTIONAL_FAILURE_SAFE 0/5; SAFETY_FAILURE 0/5; UNKNOWN 1/5.** A falha segura original de x44 continua preservada, não apagada nem convertida retroativamente em PASS.

*PASS é o resultado da rubrica congelada. Há um defeito adicional de apresentação, fora dessa rubrica: os previews de x41, x44 e x46 mostram `America/informação que falta` no lugar de `America/Sao_Paulo`. O compositor trata qualquer palavra com underscore como campo técnico; `readable()` reescreve `Sao_Paulo`. O defeito foi identificado por inspeção das respostas reais, não foi corrigido neste ciclo e impede afirmar que toda a apresentação está correta. Os valores do backend e os planos permanecem preservados.

## Banco e preflight

Instância antiga: system identifier `7687780232200184720`, PID anterior 6344, diretório `%TEMP%/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data`. Foi desligada normalmente e preservada. Backup lógico adicional: 1.942.061 bytes, SHA-256 `24679ed50697d8dc622dc54e5a1995e0597b410579df1e1c8b3f25283f07d236`.

Baseline adotado em `127.0.0.1:55441/everflair_service_mvp`, schema `public`: cluster restaurado `%TEMP%/everflair-service-mvp-dumpcheck-20260924-uxbaseline/data`, system identifier `7689285600966560972`, PID de inicialização 36508. Proveniência: dump aprovado SHA-256 `03e22cd9b2ee0233e65faf4954117c640bf621ddd400b4a1ede5df5e8aba08d3`. O identificador é o do novo cluster de restore lógico, não o da fonte física original.

**CANONICAL_PREFLIGHT_OK.** Foram conferidos IDs/valores/bindings/hashes além das contagens: 5 Salons/configurações; 15 users; 5 memberships; 10 profissionais; 140 jornadas; 35 vínculos profissional-serviço; 25 clientes; 30 serviços; 10 produtos; 7 agendamentos; 7 service items; 5 pagamentos; 86 AuditLogs históricos (13/12/15/19/27). Role `mvp_service_runtime`: SUPERUSER=false, BYPASSRLS=false. RLS/FORCE em 19 tabelas; isolamento, bloqueio cross-tenant e ausência de contexto passaram.

Antes da revalidação: health-check e fixtures/snapshots passaram novamente. Os três AuditLogs técnicos da tentativa falha de x44 foram aceitos apenas pelo hash exato do resultado durável anterior; não foram removidos nem ignorados. Manifest de retomada: `41f02740840c4d1455bdcb74ecd7bb0645fef3b58e02b61f3a3c49355cba17e0`.

## Diagnóstico e correção — ciclo 1 de no máximo 2

**CONTRACT_MISMATCH demonstrado offline.** `selectionSchema` exige `^[a-z][a-z0-9_]{0,31}$`: 1–32 caracteres, início minúsculo ASCII, restante minúsculas/dígitos/underscore. V2 herda essa regra; não existe divergência de regex V1/V2. Luna fornece `item_key` diretamente na function call. O witness valida o JSON recebido antes de adapters/compositor; `runServicesTurn` volta a validar antes do handler. Para independentes com chave ausente/null, somente depois da validação o backend pode gerar `action_N`.

A conversão Zod→JSON Schema do SDK 0.18.0 publicou `item_key` como `string|null`, sem o pattern, tanto em V1 quanto V2. A reprodução sintética provou que uma chave como `A` cabia no contrato publicado e era rejeitada localmente. **Esse exemplo não é o valor histórico de x44.** Os valores originais não foram retidos; a evidência histórica registra somente `invalid_format` em `operations[0].item_key` e `operations[1].item_key`. O formato exato observado permanece desconhecido. Não há base para afirmar MODEL_OUTPUT_INVALID contra um contrato publicado equivalente, nem para atribuir o incidente exclusivamente ao Luna.

Correção em `packages/salon-secretary/src/index.ts`: publicar no Function Tool os constraints originais de `item_key` e, em V2, de `depends_on`, obtidos do schema Zod nativo. Regex/local validator, operações, domínio, permissões e gabarito não mudaram. Nenhuma chave é normalizada para acomodar output inválido. O teste passa pela serialização real do SDK com fetch sintético, sem rede, e comprova pattern presente/strict=true/store=false, além da rejeição de chaves inválidas.

A retomada usa runner/manifest/journal separados. O manifest antigo continua recusando o novo runtime; o novo valida exatamente o delta de um arquivo com hashes BEFORE/AFTER, os hashes dos predecessores, o oracle/fixtures originais e a contagem acumulada de requests. A primeira tentativa e seus diagnostics/usage permanecem intactos. Apenas x44 ganhou uma revalidação após correção; x46 foi primeira execução.

## Qualidade e continuidade

Nos **8 turnos concluídos e avaliáveis**, os oito contadores foram zero: TECHNICAL_FIELD_LEAK, DUPLICATE_QUESTION, UNNECESSARY_QUESTION, MISSING_REQUIRED_QUESTION, INVENTED_REQUIRED_FIELD, WRONG_ENTITY_AUTO_SELECTED, DRAFT_CONTINUITY_FAILURE e DEPENDENCY_FAILURE. No x44 original e no x49 não executado, métricas conversacionais são N/A, não falsos zeros.

x41 preservou cliente/serviço/data e preencheu só horário. x42 preservou “corte” e as três opções após “10h.”; continuar NEEDS_INPUT foi correto. x44 preservou o bloqueio enquanto recebeu serviço/horário do agendamento. x46 perguntou uma vez “Qual serviço Fábio Santos vai fazer?”, recebeu “Corte Completo.” e manteve as cinco ações, mesmo plan_ref, conversation_ref, drafts e DAG; EXACT “Seu horário foi cancelado.” permaneceu intacto no preview, sem envio.

| Caso | Ações | plan_ref preservado nos 2 turnos | Estado final |
| --- | --- | --- | --- |
| x41 | 1 | `ae5af3b8-05c0-4628-9aef-b5f30b87d549` | READY_FOR_CONFIRMATION / NORMAL_REVIEW |
| x42 | 1 | `de811891-a6f9-4bb9-a034-a66bf947e9c0` | NEEDS_INPUT / NORMAL_REVIEW |
| x44 | 2 | `b377f326-44b8-4d68-9615-df8e969febcc` | READY_FOR_CONFIRMATION / NORMAL_REVIEW |
| x46 | 5 | `3159cb20-c79b-4af2-9ff5-fb8077e32e59` | READY_FOR_CONFIRMATION / NORMAL_REVIEW |
| x49 | N/A | N/A | NOT_STARTED |

A proveniência, campos explícitos, missing fields, operações e confirmation groups passaram no scorer estrutural congelado. x46: `cancel_amanda→book_fabio` e `cancel_amanda→message_amanda`; Services e Financial independentes. Não se afirma aprovação real de 10 ações/ADVANCED_REVIEW neste recorte, pois x49 não iniciou.

Conversação histórica permanece **6/10**. No componente estrito de clarificação medido agora: **10/10 nos 8 turnos avaliáveis**, calculado por 32/32 verificações (pergunta necessária, não repetida, não desnecessária, sem campo técnico). Isso não é nota global dos cinco casos nem aprovação da apresentação completa: cobertura 4/5 casos e defeito de fuso fora da rubrica. **Não há nota global conclusiva nem VALIDATED.**

## Latência por turno

Valores em milissegundos. Database é tempo observado em queries e se sobrepõe às fases; não deve ser somado novamente ao E2E. Compositor está dentro da finalização. Sem tempo humano.

| Caso/turno | HTTP | Modelo total | Parsing | Backend | Database | Compositor | E2E |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| x41/1 | 5168.101 | 5317.629 | 42.466 | 138.187 | 316.751 | 0.146 | 5792.816 |
| x41/2 | 1805.123 | 1925.673 | 28.502 | 164.221 | 126.012 | 0.389 | 2185.529 |
| x42/1 | 5120.117 | 5358.237 | 30.906 | 17.716 | 22.463 | 0.133 | 5466.924 |
| x42/2 | 2121.076 | 2246.664 | 25.975 | 15.715 | 18.834 | 0.043 | 2345.551 |
| x44/1 pós-fix | 8134.321 | 8332.692 | 44.087 | 84.839 | 150.956 | 0.204 | 8631.540 |
| x44/2 pós-fix | 1657.461 | 1760.216 | 25.661 | 130.844 | 91.700 | 0.376 | 1996.892 |
| x46/1 | 10377.269 | 10523.530 | 43.213 | 101.530 | 89.445 | 0.112 | 10735.509 |
| x46/2 | 2077.100 | 2229.389 | 37.486 | 107.709 | 91.964 | 0.254 | 2445.223 |
| x44/1 original | 6848.649 | 7087.386 | N/A | N/A | N/A | N/A | N/A |

A captura da ponte de x44 original durou 7124,488 ms; não é E2E completo T0–T5, pois o parser interrompeu o fluxo. A cobrança desse request está incluída abaixo.

| Conversa | E2E histórico (s) | E2E atual concluído (s) | Delta observado |
| --- | ---: | ---: | ---: |
| x41 | 5.841 | 7.978 | 36.6% |
| x42 | 6.141 | 7.812 | 27.2% |
| x44 | 10.959 | 10.628 | -3.0% |
| x46 | 12.910 | 13.181 | 2.1% |
| x49 | 20.926 | N/A | N/A |

Uma conversa por caso e versão, sem p95 estatístico. As comparações são descritivas, sem controle de cache/transporte; x44 atual contém apenas a revalidação concluída. A tentativa original permanece separada. Compositor observado entre 0.043 e 0.389 ms, uma chamada local por turno. O tempo dominante é Luna; não houve inferência adicional para formatar texto. Não é possível atribuir causalmente as diferenças de E2E ao compositor.

## Tokens e custo

Tarifa congelada aprovada, USD/milhão: input 0,10; cached 0,01; cache write 0,125; output 0,50. Cached/cache write são subconjuntos de input; reasoning está incluído no output. Estimativa, não fatura.

| Request | Input | Cached | Cache write | Output | Reasoning | Total | USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| x41/1 | 2828 | 0 | 2695 | 243 | 64 | 3071 | 0.000471675 |
| x41/2 | 1321 | 0 | 1186 | 106 | 0 | 1427 | 0.000214750 |
| x42/1 | 2826 | 2662 | 31 | 245 | 68 | 3071 | 0.000166295 |
| x42/2 | 1319 | 1129 | 55 | 104 | 0 | 1423 | 0.000083665 |
| x44/1 original | 2839 | 2662 | 44 | 645 | 316 | 3484 | 0.000367920 |
| x44/1 pós-fix | 2883 | 0 | 2750 | 606 | 279 | 3489 | 0.000660050 |
| x44/2 pós-fix | 1319 | 1129 | 55 | 99 | 0 | 1418 | 0.000081165 |
| x46/1 | 2915 | 2706 | 76 | 1077 | 260 | 3992 | 0.000588360 |
| x46/2 | 1300 | 0 | 1165 | 161 | 59 | 1461 | 0.000239625 |
| **Total: 9** | **19550** | **10288** | **8057** | **3286** | **1046** | **22836** | **0.002873505** |

Custo novo da retomada: US$0.001569200. Total inclui a tentativa original de x44; reserva acumulada conservadora US$0,117 de US$0,13. x49 não iniciou porque o limite de requests, não o custo estimado, impede uma conversa completa.

## Snapshot final e segurança

**POST_BATTERY_SNAPSHOT_PASS**, consulta independente após a retomada. Hashes de todas as tabelas operacionais dos cinco tenants iguais ao baseline; estado final igual ao persistido pelos runners. Role e 19 flags RLS/FORCE preservadas; cada tenant enxergou seus cinco clientes e zero clientes/serviços/auditorias estrangeiros; sem contexto: zero clientes.

| Caso | AuditLogs baseline | AuditLogs final | Acréscimo técnico |
| --- | ---: | ---: | ---: |
| x41 | 13 | 26 | 13 |
| x42 | 12 | 24 | 12 |
| x44 | 15 | 33 | 18 |
| x46 | 19 | 38 | 19 |
| x49 | 27 | 27 | 0 |

AuditLogs: **86→148**, todos os 62 registros novos classificados como técnicos pelo journal (draft/proposal/usage/router/outros eventos técnicos). Não confundir com escritas operacionais. **Operational writes=0; confirmações=0; Outbox=0; mensagens externas=0; JEV=0; hosted tools=0; containers=0.** Nove witnesses com GPT-6 Luna/store=false/retries=0. Nenhum resultado depende apenas de memória: 44 eventos no journal original e 37 no novo, cadeias SHA verificadas, fsync e checkpoints preservados.

Flags finais conferidas: **V2=false, paid=false, JEV=false**. `.env.local` permanece com o mesmo SHA-256. Banco canônico saudável e ativo; cluster antigo continua preservado/desligado. Nenhum rollback automático apagou a evidência técnica.

## Checks e arquivos

- Direcionados iniciais: 67 PASS / 4 arquivos.
- Suíte geral: 2.453 PASS / 275 arquivos.
- Após completar a guarda de admissão de casos: 23 PASS / 2 arquivos, incluindo o teste novo de orçamento. O total da suíte completa anterior não inclui esse último teste adicional.
- Lint final: PASS, sem erros/warnings. TypeScript final: PASS. Build local: PASS.
- Preflight de retomada e snapshot final PostgreSQL: PASS. Nenhuma migration; nenhum seed/integration destrutivo foi executado.

Arquivos deste ciclo: `packages/salon-secretary/src/index.ts`; `evaluation/conversational-ux-self-healing-{plan.json,target.ts,real.ts}` no pacote; `scripts/run-conversational-ux-self-healing.{ts,cjs}`; teste novo `src/lib/__tests__/secretary-item-key-wire.test.ts`; atualização do teste de binding `conversational-ux-target.test.ts`; este relatório e `docs/STATUS_ATUAL.md`. A atualização do teste de binding exige que o guard antigo rejeite o runtime novo e que o novo selo aceite somente o delta autorizado; os expecteds funcionais dos cinco casos não foram alterados. Artefatos locais ignorados incluem backups BEFORE, diagnóstico, logs de checks, manifests, journals, snapshots e consolidado JSON. Trabalho preexistente do worktree preservado.

## Conversas reais completas

### x41

**USER — turno 1**

Marca um Corte Completo pro Andrinho amanhã.

**SECRETÁRIA**

```text
Qual horário você quer para Andrinho?
```

**USER — turno 2**

10h.

**SECRETÁRIA**

```text
NOVO AGENDAMENTO
Cliente: Andrinho
Serviço: Corte Completo
Profissional: Tatiana
Data: 2026-10-06
Horário: 10:00–10:45 (America/informação que falta)
Preço: R$ 50,00

Confira os detalhes antes de confirmar.
```

### x42

**USER — turno 1**

Marca um corte pro Andrinho amanhã.

**SECRETÁRIA**

```text
Qual serviço você deseja para Andrinho?
• Corte + Barba
• Corte Completo
• Corte Infantil
```

**USER — turno 2**

10h.

**SECRETÁRIA**

```text
Qual serviço você deseja para Andrinho?
• Corte + Barba
• Corte Completo
• Corte Infantil
```

### x44

A primeira tentativa recebeu HTTP 200 e foi rejeitada antes de produzir resposta conversacional. Abaixo, a única revalidação após fix.

**USER — turno 1**

Agenda o Andrinho amanhã e bloqueia a Tatiana amanhã das 14h às 15h.

**SECRETÁRIA**

```text
Qual serviço e horário você quer para Andrinho?
```

**USER — turno 2**

Corte Completo às 10h.

**SECRETÁRIA**

```text
NOVO AGENDAMENTO
Cliente: Andrinho
Serviço: Corte Completo
Profissional: Tatiana
Data: 2026-10-06
Horário: 10:00–10:45 (America/informação que falta)
Preço: R$ 50,00

BLOQUEAR AGENDA
Tatiana
2026-10-06T14:00–2026-10-06T15:00 (America/informação que falta)
0 agendamento(s) atingido(s), preservado(s).

Confira os detalhes antes de confirmar.
```

### x46

**USER — turno 1**

Cancela Amanda Souza amanhã às 10h por pedido dela, coloca Fábio Santos no lugar, avisa Amanda Souza no WhatsApp exatamente "Seu horário foi cancelado.", altera a Massagem para R$80 e me fala quanto faturei ontem.

**SECRETÁRIA**

```text
Qual serviço Fábio Santos vai fazer?
```

**USER — turno 2**

Corte Completo.

**SECRETÁRIA**

```text
ALTERAÇÕES NA AGENDA
1. CANCELAR: Amanda Souza — Corte Completo
2026-10-06T10:00–2026-10-06T10:45 (America/informação que falta)
Motivo: a pedido dela
Fila ativa: 0, preservada sem promoção.
2. AGENDAR: Fábio Santos — Corte Completo
Tatiana — 2026-10-06T10:00–2026-10-06T10:45 (America/informação que falta)
R$ 50,00

MENSAGEM — SIMULAÇÃO LOCAL
Para: Amanda Souza ((11) *****-4321)
Canal: WhatsApp (fake, sem envio externo)
Mensagem:
Seu horário foi cancelado.

Vou alterar:
Nome: Massagem (sem alteração)
Preço: R$ 100,00 → R$ 80,00
Duração: 60 minutos (sem alteração)
Demais campos e relações preservados.

Período: 2026-10-04 até 2026-10-05 (fim exclusivo), America/informação que falta.
Consultado em 2026-10-05T12:00:00.000Z.
Faturamento bruto de serviços de atendimentos concluídos, pela data do atendimento (dashboard); antes de ajustes do fechamento.
R$ 120,00

Agendar — Fábio Santos só poderá ocorrer após cancelar agendamento — Amanda Souza.

Preparar mensagem — Amanda Souza só poderá ocorrer após cancelar agendamento — Amanda Souza.

Confira os detalhes antes de confirmar.
```

### x49

Não executado; nenhum texto sintético apresentado como real.

## Evidência e rollback

- `packages/salon-secretary/evaluation/results/conversational-ux-real/real.jsonl` — SHA-256 `0b99294241d1ae79aaa0e885c1bf1732fa0861419fc3875a07a97f08ccdff705`.
- `packages/salon-secretary/evaluation/results/conversational-ux-real/self-healing/real.jsonl` — SHA-256 `3fac0650527fd1569b3ea41d08a467d6f8b0c5e40189a9ed0e8182d923902699`.
- `packages/salon-secretary/evaluation/results/conversational-ux-real/real-result-1790301918950.json` — SHA-256 `f037157d44ee91977c4fd5d75f4d81b5d52a055beddc08b03fdd201908971249`.
- `packages/salon-secretary/evaluation/results/conversational-ux-real/self-healing/real-result-1790302911510.json` — SHA-256 `0218a3d05524088bd2c997e3e1b6b472c8f6bb05f8b299aedeb1b6657686c16e`.
- `packages/salon-secretary/evaluation/results/conversational-ux-real/self-healing/post-battery-snapshot.json` — SHA-256 `19d43b804861f9766ed4e8bf5ae2910cae09b6e7e5a9562381b03b582166ae52`.

Consolidado machine-readable: `packages/salon-secretary/evaluation/results/conversational-ux-real/self-healing/consolidated-result.json`, com ActionPlans completos por turno, campos, proveniência, grupos, referências e métricas. Artefatos em results são locais/ignorados pelo Git.

Rollback de código: manter flags OFF e, se explicitamente decidido, restaurar somente `index.ts` pelo backup `self-healing/index.ts.before` (SHA-256 `24a4b5d5c73b66887af381077a20069641000d0f4731fed99e5544d57e1bc572`); não executar runners novos. Não reverter o worktree inteiro. Rollback do banco, apenas sob decisão explícita: preservar o estado técnico atual, parar normalmente o cluster adotado, confirmar porta livre e reiniciar o cluster antigo preservado em 55441 com os parâmetros registrados em `canonical-switch/before-switch.json`; validar identidade e flags. Não apagar/restaurar fixtures individualmente.

Encerramento: parada por admissão de orçamento antes de x49. Nenhuma inferência adicional, nova bateria, Front/Meta, overlap/override ou deploy.
