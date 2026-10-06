# Preflight dos caminhos de observação dos oracles

## Causa demonstrada

Um oracle convertido procurou `service_ref` em `effective` de `service.change`. A projeção factual dessa operação contém os campos editáveis do draft (`name`, `priceCents`, `durationMin`); a identidade está em `proposal.change.service_ref` e no draft original. O scorer comparou corretamente o caminho solicitado, que não existia. A configuração incompatível deveria ter sido bloqueada antes da bateria.

A correção é do harness. Não há fallback para procurar o valor esperado em outro lugar, alteração de `observeView`, relaxamento do scorer ou reclassificação do resultado histórico. Não se leu o novo holdout selado.

## Contrato fechado

`free-use-oracle-projection.ts` publica um catálogo finito e imutável, versionado como `free-use-observed-paths-v2`, para todas as 18 operações do catálogo publicado. Cada operação declara os caminhos comparáveis em quatro superfícies: `fields`, `effective`, `proposalFields` e `resultContains`.

- `fields` representa os campos aceitos reconstruídos por `collectedActionFields`, incluindo os campos neutros comuns de seu contrato. Provas transitórias do wire, como source_scope e inventory.quantity_evidence/reference, são removidas e não são caminhos admissíveis de estado aceito.
- `effective` representa exatamente o snapshot escolhido por `observeView`, com `product_ref` adicional apenas na projeção de estoque. Referências não são copiadas entre superfícies.
- `proposalFields` segue as formas de proposta existentes, incluindo change, snapshot, action_snapshot, batch e comunicação dependente.
- `resultContains` segue a projeção consumida pelo scorer. No financeiro, compara os itens de `metrics`, não a raiz do relatório.
- `preserve`, `forbiddenEffective` e `sourceBackedEffective` usam somente caminhos de `effective`.
- `allowMissing` precisa apontar para um check existente de fields/effective/proposalFields e válido naquela superfície.
- Caminhos arbitrários, curingas, segmentos de prototype e travessia de arrays de objetos não são aceitos. O `valueAt` existente também não percorre arrays. Arrays inteiros continuam comparáveis no limite de `fieldValue`, inclusive arrays de objetos vazios (`[]`).

O catálogo valida **possibilidade estrutural**, não a presença nem o valor de um campo em determinado turno. Campos opcionais continuam admissíveis; a comparação com valores esperados continua sendo responsabilidade do scorer. Um ID, preço, data ou quantidade errados em caminho válido não ganham exceção.

## Admissão antes de efeitos

`suiteSchema` aplica a validação a todos os oracles de uma suíte. Schemas de fragmentos permanecem sintáticos, preservando testes unitários abstratos do scorer; eles não constituem autorização para executar uma suíte.

`preflightFreeUseSuite` é puro e retorna `VALID` com os mesmos defaults/normalizações anteriores, ou `BLOCKED` com localização do problema. `parseFreeUseSuite` emite código estável `FREE_USE_ORACLE_PROJECTION_INVALID` para caminho incompatível e `FREE_USE_SUITE_INVALID` para os outros erros de contrato.

O runner usa esse parser ao preparar e ao carregar uma execução. No prepare, ele roda antes de criar o cliente Prisma admin, executar consultas, backup ou seed. O singleton Prisma do módulo pode ser inicializado ao importar o runner; o teste não afirma ausência dessa inicialização. No run, o parser roda antes de preparar rede/budget/despacho. O CLI existente já apresenta erros como BLOCKED e desliga paid calls. Não há consulta DB/API no preflight nem orçamento consumido por ele.

## Validação

- Golden 30 intacta aceita pelo contrato, com mensagens/expecteds e scorer preservados.
- Rejeições em múltiplos domínios/superfícies: service_ref e customer_ref no snapshot editável, stock fora de product, identidade temporal fora de snapshot/action_snapshot, destinatário fora de recipient, path financeiro errado, typo e prototype.
- Paths corretos aceitos mesmo opcionais/nulos; normalization/defaults preservados.
- Wrong entity e wrong price em caminhos válidos continuam **FAIL e safety failure** no scorer original.
- Teste chama o **prepare real** com arquivo de entrada e dependências simulados: bloqueio antes do constructor Prisma admin, acesso a banco, backup, seed ou fetch.
- Primeira validação: 70/70 testes locais. A revisão independente posterior encontrou formas reais ausentes e campos transitórios aceitos; esse primeiro freeze e seus resultados de falha estão preservados em `.demo/oracle-projection-v1-preserved/` e `.demo/free-use-oracle-projection-freeze-v1.json`.
- A versão 2 cobre a união comprovada de customer.search resolvido, cancelamento com proposta compartilhada de comunicação, política e snapshots batch e arrays vazios. Acrescenta regressões contra campos somente de transporte. Validação local: **77/77 em quatro suítes**, TypeScript global e lint afetado PASS. Os logs da versão 2 são publicados separadamente; nenhuma chamada paga, DB, confirmação ou execução operacional.

Logs e manifesto de congelamento em `.demo/free-use-oracle-projection-*`.

## Manutenção e limites

Uma nova operação exige atualizar o catálogo (cobertura de tipos e teste contra publishedOperation). Um novo caminho legítimo exige revisão explícita da projeção, com teste. Até lá, a suíte fica bloqueada; não há fallback permissivo. O catálogo não tenta validar regras de negócio, resolver entidade, corrigir mensagens ou inferir a intenção do usuário.

Esse gate não torna uma bateria PASS por si só e não apaga a execução interrompida. Uma nova bateria independente deve ser admitida e executada somente após congelamento e revisão dos gates.
