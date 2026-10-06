# Minimum Clarification — validação final

**MINIMUM_CLARIFICATION_UX = VALIDATED. Frente encerrada.**

24/09/2026, horário de São Paulo. Executado somente x49, uma vez, com seus
dois turnos congelados. Nenhuma repetição de x41/x42/x44/x46; journals,
fixtures, mensagens, expected e rubrica anteriores preservados.

| Caso | Resultado consolidado |
| --- | --- |
| x41 | PASS preservado |
| x42 | PASS preservado, ambiguidade respeitada |
| x44 | PASS após correção de contrato anterior; falha original preservada |
| x46 | PASS preservado |
| x49 | PASS real nos dois turnos desta etapa |

**5/5 PASS; FUNCTIONAL_FAILURE_SAFE final=0; SAFETY_FAILURE=0; UNKNOWN=0.**
A falha segura original de x44 não foi apagada nem reclassificada retroativamente.

## Correção visual comprovada

O regex de `readable()` tratava `Sao_Paulo` como campo interno por conter
underscore, produzindo `America/informação que falta`. A reprodução offline
usou os planos reais preservados de x41/x44/x46 e demonstrou o defeito sem rede.

O compositor agora reconhece o nome IANA completo com `Intl.DateTimeFormat`
antes de traduzir tokens técnicos. Preserva `America/Sao_Paulo`,
`America/New_York` e `America/Argentina/Buenos_Aires`; campos internos continuam
traduzidos e EXACT permanece protegido. Não altera datas, horários, regras,
resolução, schema, domínio ou ActionPlan. O preview real de x49 confirmou o fuso
correto. Os casos anteriores foram apenas renderizados offline, não repetidos.

## x49 observado

Turno 1: as dez ações foram preservadas; faltavam somente serviço de Fábio e
fim do bloqueio de Tatiana. Resposta real:

```text
7 itens já estão preparados. Só preciso de duas informações:

1. Qual serviço Fábio Santos vai fazer?
2. Até que horas devo bloquear a agenda de Tatiana?
```

As oito ações sem informação faltante mantiveram seus campos. A contagem de
sete itens preparados é correta no contrato congelado: o cancelamento aguarda
a preparação do componente cancel→create, sem desaparecer do plano.

Turno 2, resposta congelada do usuário:

```text
Corte Completo para o Fábio e bloqueia até 16h.
```

Resultado: `READY_FOR_CONFIRMATION`, `ADVANCED_REVIEW`, dez ações. A Secretária
apresentou a proposta completa, com `America/Sao_Paulo`, Corte Completo
10h–10h45, bloqueio 14h–16h e a orientação “Confira os detalhes antes de confirmar.”
Nenhuma confirmação foi feita.

Comparação campo a campo comprovada:

| Ação | Campo | Antes | Depois |
| --- | --- | --- | --- |
| create_fabio | service_name | null | Corte Completo |
| block_tatiana | end_time | null | 16:00 |

Nenhum outro campo de intenção mudou. As outras oito ações preservaram campos,
operação e proveniência. Mesmo conversation_ref, plan_ref, drafts e action keys;
dependências idênticas, incluindo cancel→create e cancel→message.
`plan_ref=13c48e4c-0ef9-476a-9fad-5f125e4677b8` nos dois turnos.
Texto EXACT “Seu horário foi cancelado.” preservado somente no preview.

Os oito contadores conversacionais pedidos foram **zero em ambos os turnos**:
TECHNICAL_FIELD_LEAK, DUPLICATE_QUESTION, UNNECESSARY_QUESTION,
MISSING_REQUIRED_QUESTION, INVENTED_REQUIRED_FIELD, WRONG_ENTITY_AUTO_SELECTED,
DRAFT_CONTINUITY_FAILURE e DEPENDENCY_FAILURE. SAFETY_FAILURE=0.

## Performance e custo de x49

| Turno | Luna HTTP | Luna total | Backend | Database | Compositor | E2E | Tokens | USD estimado |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 21,776 s | 22,405 s | 215,462 ms | 272,043 ms | 0,316 ms | 22,842 s | 5.132 | 0,001450050 |
| 2 | 4,981 s | 5,209 s | 151,492 ms | 123,045 ms | 1,016 ms | 5,489 s | 3.164 | 0,000578175 |

Total de processamento: **28,331 s**, sem tempo humano. Database se sobrepõe
às fases e não deve ser somado novamente ao E2E. Uma amostra por turno, sem p95.

| Turno | Input | Cached | Cache write | Output | Reasoning | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2.967 | 0 | 2.834 | 2.165 | 580 | 5.132 |
| 2 | 2.668 | 0 | 2.535 | 496 | 173 | 3.164 |
| Total | 5.635 | 0 | 5.369 | 2.661 | 753 | 8.296 |

Cache write é subconjunto de input; reasoning está incluído no output.
Custo novo **US$0,002028225**, abaixo do teto adicional anunciado de US$0,026.
Tarifa congelada aprovada: USD/milhão input 0,10, cached 0,01, cache write 0,125,
output 0,50. Estimativa, não fatura. Não houve inferência para formatação.

Acumulado das três execuções preservadas: **11 requests, 31.132 tokens,
US$0,004901730**, incluindo a tentativa original rejeitada de x44. As duas
requests adicionais são as explicitamente autorizadas para x49 neste Gate.

## Validação e segurança

- 57 testes direcionados PASS; suíte geral **2.462 testes / 275 arquivos PASS**.
- Lint, TypeScript e build local PASS.
- Preflight/health-check PASS: cinco snapshots preservados, fixture de x49
  íntegra, runtime sem SUPERUSER/BYPASSRLS, RLS/FORCE em 19 tabelas, isolamento.
- Snapshot independente final PASS: hashes operacionais dos cinco tenants
  idênticos ao baseline; cross-tenant sem visibilidade e ausência de contexto
  bloqueada. Banco canônico saudável.
- **Operational writes=0; confirmations=0; Outbox=0; external messages=0.**
- Dois requests GPT-6 Luna, store=false, retries=0, JEV=0, hosted tools=0,
  containers=0. Witness, journal/hash-chain, fsync e checkpoints preservados.
- AuditLogs de x49: 27→54 por registros técnicos; total dos cinco tenants
  148→175. Não são alterações operacionais.
- Flags finais **Multi-Action V2=false, paid=false, JEV Router=false**;
  `.env.local` inalterado. Sem reseed, migrations, deploy, Front/Meta ou override.

Mudanças desta etapa: compositor `conversational-presentation.ts`; testes de
apresentação/binding; runner e manifests novos `conversational-ux-final-*`;
entrada `scripts/run-conversational-ux-final.{ts,cjs}`; documentação. O novo selo
reconhece somente os deltas autorizados, e os manifests antigos continuam
rejeitando código diferente. Nenhum gabarito funcional foi alterado.

Rollback: flags OFF; caso necessário, restaurar somente o compositor pelo
backup `final-x49/conversational-presentation.ts.before`. Não reverter o
worktree inteiro nem restaurar banco: dados operacionais não mudaram.

Evidência local, ignorada pelo Git:

- [Validação final, ActionPlans antes/depois e conversas completas](../packages/salon-secretary/evaluation/results/conversational-ux-real/final-x49/final-validation.json)
- [Journal durável](../packages/salon-secretary/evaluation/results/conversational-ux-real/final-x49/real.jsonl)
- [Snapshot final independente](../packages/salon-secretary/evaluation/results/conversational-ux-real/final-x49/post-battery-snapshot.json)
- [Regressão offline do fuso](../packages/salon-secretary/evaluation/results/conversational-ux-real/final-x49/timezone-offline.json)
- [Checks e hashes](../packages/salon-secretary/evaluation/results/conversational-ux-real/final-x49/checks.json)

Manifest x49 SHA-256:
`2ef706a6c8281bfeb56d5821acfb1f3523c3a65b446d917f8c2dc764763a2eeb`.
Frente encerrada, sem nova bateria de clarificação.
