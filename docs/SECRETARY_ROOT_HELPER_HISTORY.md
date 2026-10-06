# Replay histórico dos helpers de cliente e identidade

27/09/2026. Correção exclusiva de fixtures e testes. Nenhum runtime, leitor histórico, manifest, runner, oracle ou autorização foi alterado.

`frontHistoricalFs` fornece bytes arquivados quando existe uma entrada e usa a leitura real para os demais arquivos. Após os reparos funcionais de `customer-catalog.ts` e `scheduling-entity-mentions.ts`, esses dois arquivos ainda estavam fora do archive. O teste histórico lia seus bytes atuais e `verifyPrior` rejeitava corretamente a divergência com `X94_UNAUTHORIZED_SOURCE_DRIFT`.

Os originais já preservados em `.demo/holdout-v2-root-before/` foram conferidos contra os manifests imutáveis:

| Fonte | SHA-256 original |
| --- | --- |
| customer-catalog.ts | 3799e16963184ea06f656a755a1d7b7f162982bdc85ef387bf4948ab6c123e5b |
| scheduling-entity-mentions.ts | 69d8fe34eb335140323c1ec8860f0311e99c56a09199a6824173a47d10b399e0 |

Os dois manifests históricos apontam para os mesmos bytes. Foram acrescentadas somente essas duas entradas a cada archive:

- `secretary-front-predecessor.json`: as 22 entradas anteriores permaneceram idênticas;
- `secretary-v1-frozen-sources.json`: as 25 entradas anteriores permaneceram idênticas.

O processo preservou os arquivos anteriores e os hashes antes/depois em `.demo/root-helper-history-before/`. A inserção preserva o texto de todas as entradas anteriores; valida ainda cada valor decodificado e seu hash contra o manifest original. Não há novo baseline de runtime.

Os adapters continuam exclusivos de teste. A leitura real segue recebendo o código atual e rejeitando a autorização antiga. A lista de cinco arquivos originalmente autorizados para X94 permanece intacta. O novo teste demonstra também rejeição de um byte adulterado e de uma fonte que não pertença ao manifest.

A publicação fechada JEV não inclui estes dois helpers backend: `publishedDecisionCatalog` usa os descritores do registry, os requisitos financeiros, as semânticas fechadas de inventário e comunicação. Seus fingerprints e a allowlist continuam os mesmos. Os testes da publicação, derivação e aceitação foram executados com transporte simulado.

Validação: **110/110 PASS em sete suites**, incluindo os dois testes históricos que falhavam, os dois readers, adulteração, runtime atual bloqueado antes de acesso ao cliente de banco ou fetch, e contratos JEV. Log `.demo/root-helper-history-focused-v1.log`. Lint do novo teste: PASS. Nenhuma chamada real a API ou banco; nenhum resultado conversacional histórico foi reclassificado.
