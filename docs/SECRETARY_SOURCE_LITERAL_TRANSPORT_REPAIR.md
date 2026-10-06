# Recuperação limitada de provas literais por papel

Estado: implementação local, provas offline; ainda depende de revisão independente e gates integrados. Não comprova Golden, holdout ou staging.

## Propriedade corrigida

GF15 da Golden v10 demonstrou seletores temporais semanticamente corretos com provas traduzidas que não existiam na mensagem atual. O backend recusou corretamente as provas; o fluxo perdeu os campos. Os novos contratos de inventário têm a mesma propriedade: uma prova transportada separadamente de seu valor pode ser traduzida/parafraseada apesar de a semântica estar correta.

O primeiro reparo temporal foi preservado integralmente em `.demo/temporal-repair-before-generalization/`, com o manifesto e os treze arquivos verificados pelo SHA-256 anterior. A evolução usa um registro fechado de folhas de evidência em `source-literal-repair.ts`, compartilhando um só reparo entre todos os domínios:

| Container validado | Prova elegível |
| --- | --- |
| Campos temporais publicados | `temporalValueRoles[field].literal` |
| Campos da ação | `source_scope` |
| Inventário | `quantity.literal` |
| Referência de inventário `NAMED` | `reference.literal` |

Não existe busca genérica por strings chamadas `literal`. Nomes, motivos, `override_reason`, texto de Communication EXACT, preços, quantidades semânticas e dados arbitrários não pertencem ao registro. `null` e campos ausentes não são preenchidos. `CURRENT_FIELD` mantém `literal:null`, sem converter referência por reparo.

## Mesma fronteira, uma só tentativa adicional

A resposta inteira precisa passar primeiro o schema LIVE exato e a validação de seleção/roteamento. Somente folhas elegíveis presentes, estruturalmente válidas e ausentes como substring **exata** da mensagem atual qualificam. O modelo recebe os caminhos exatos e o envelope anterior como dados; deve copiá-los sem tradução, paráfrase ou supressão de variantes, unidades, fatores, negações e qualificadores.

O controlador compara o envelope completo e aceita mudanças apenas nas folhas originalmente inválidas. Valores, `product_name`, `reference.kind`, modo, operação, campos de negócio, provas já válidas, ordem, ações, chaves, grafo e intenção ficam idênticos. A segunda resposta valida novamente o contrato inteiro; uma única família ainda inválida rejeita o conjunto. Não há terceira chamada, novo planejamento nem reparo de falha de schema, API, timeout ou contradição factual com prova já exata.

Antes de `receive` e da persistência de campos, o controlador seleciona explicitamente a segunda resposta original. Não modifica os objetos originais nem substitui respostas para observadores. O modo registrado estático mantém reprodução histórica sem recuperação automática; o Agent público continua sempre LIVE.

Substring exata é apenas transporte. Os guards do domínio continuam verificando calendário/papel, unidades, fatores, negação, identidade/variante, escopo sem sobreposição e contexto publicado. Os testes de provas reparadas com variante omitida, fator, negação, contagem errada, calendário errado e escopos sobrepostos permanecem bloqueados. RLS, permissões, confirmação, EXACT, idempotência e transações não mudam.

## Custo e auditoria

Runner de um turno e wrapper de uma chamada permanecem; a única exceção autoriza uma segunda chamada pelo mesmo modelo instrumentado, vinculada à identidade do request original em WeakMap privado. Cópias, proxies, outro run, concessão repetida e terceira chamada falham. A primeira chamada precisa completar e persistir seu terminal antes da segunda.

Cada tentativa tem seus próprios IDs de STARTED/terminal, o mesmo run/sessão/tenant, `attempt` e `purpose`. O propósito generalizado é `SOURCE_LITERAL_REPAIR`. O trace soma todas as tentativas e informa `transport_repair_calls` e `retries`. Falha de auditoria impede dispatch/consumo. Cada HTTP passa pela mesma reserva durável de orçamento; nenhum teto, journal cumulativo, guard de payload ou retry de cliente foi relaxado. Testes de reserva usam apenas journal temporário isolado.

O request usa somente system/user; conversationId, previousResponseId, armazenamento e ferramentas hospedadas continuam proibidos. Observadores passivos não consomem requests, substituem responses nem propagam falhas.

A segunda chamada mantém o schema/model settings, mas seu input contém apenas a instrução restrita, a mensagem atual, o envelope original e os caminhos inválidos. A interpretação semântica já está fixada; drafts e planos anteriores não são necessários para copiar provas. A primeira interpretação conserva todo o contexto. Isso evita repetir o histórico e exceder a admissão de 64 mil no harness. O cenário medido de dez ações ativas e cinquenta suspensas excedia o limite na chamada de reparo ao duplicar o contexto; a evidência anterior foi preservada antes do ajuste. Nenhum guard ou limite foi aumentado.

## Evidência e limites

A captura real GF15 e seu hash permanecem intactos. O teste LIVE adapta explicitamente apenas `source_scope:null`, obrigatório no contrato atual; valores e provas temporais históricos permanecem. O envelope histórico sem adaptação continua falhando LIVE, e seu replay registrado conserva a falha original. Reparos usados nos testes são respostas sintéticas offline, não resultados de Luna real.

O stress sintético de clarificação tinha mensagem `Da tarde.` e prova `da tarde`, incompatíveis com cópia exata. A migração de fixture preservou mensagem e oráculo, arquivou a versão original e ajustou somente a prova para `Da tarde`. Novos negativos demonstram que a versão inexata exige reparo e a exata permanece com uma chamada.

O manual Scheduling foi compactado textualmente para recuperar margem de input após a expansão de schema, preservando regras, papéis, autorização e limites. O schema e o teto de 64 mil com overhead 8192 permanecem iguais. Cobertura inclui as requisições serializadas reais do SDK com HTTP falso, 1/2/5/10 ações, mistura temporal/estoque, CURRENT/PATCH/RESUME, pinning, null, falha de reparo e todos os guards anteriores.

Uma revisão independente identificou separadamente propostas antigas confirmáveis após falha do turno no parent multi-action. Esse ciclo de vida está sendo corrigido pelo responsável do coordenador. O SDK sozinho não declara esse caso resolvido nem substitui a validação integrada.
