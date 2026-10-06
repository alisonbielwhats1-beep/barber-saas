# JEV: semântica fechada e instruções de extração

O diagnóstico da suíte geral encontrou uma dependência indevida: o selo do catálogo fechado incluía todo o texto `inventorySkill`. Adicionar instruções para ligar a quantidade à sua prova literal alterou o hash e fez `DerivedJevProvider` recusar todas as skills antes do transporte, inclusive financeiro. O comportamento era fail-closed, mas degradava o roteamento para Luna.

`inventory-closed-semantics.ts` publica agora a base V1 exata, recuperada do arquivo original cujo SHA já constava no manifest histórico. O manual enviado a Luna compõe essa base com as instruções atuais de extração e clarificação. `loadSkills` continua calculando o hash real do manual completo.

O catálogo JEV calcula o hash da base fechada. Permanecem intactos o hash auditado da publicação, os 13 bindings, versões, operações habilitadas, allowlist e política de aceitação. Alterar a base, a propriedade de uma operação, o catálogo ou os requisitos auditados continua sendo rejeitado. Não há hash constante em lugar do cálculo nem importação de fixture no runtime.

Evidências:

- `.demo/inventory-independent-jev-diagnosis.json`: o diagnóstico reconstrói o hash original alterando somente a identidade do manual, sem mudar bindings.
- `.demo/jev-closed-semantics-regression-confirmed.log`: 365 testes em 12 suítes PASS, incluindo rota, catálogo, políticas, erros de transporte e admissão histórica fail-closed.
- `jev-publication-boundary.test.ts`: a base faz parte do manual vivo, a modificação de `<=` para `<` bloqueia o catálogo, e o manual vivo conserva a extração atual.
- `.demo/jev-closed-semantics-before/`: fontes anteriores e cinco testes históricos preservados. Apenas o leitor explícito de bytes arquivados foi acrescentado nesses testes; mensagens, assertivas e expected anteriores permanecem intactos. Os manifests e seus hashes esperados não foram recalculados.
- `secretary-v2-historical-guards.test.ts`: a mudança no código do catálogo passou a acionar o guard anterior de predecessor. A assertiva original de rejeição do guard de inventário foi conservada em um escopo que restaura apenas o predecessor. Duas assertivas adicionais demonstram que a leitura viva rejeita antes e depois desse escopo. Nenhum guard de runtime foi alterado para satisfazer o teste. As três suítes dessa verificação passaram em 20/20 testes.

Os replays de selos históricos comprovam a preservação das evidências. Não autorizam executar o runtime atual com uma autorização antiga nem comprovam qualidade conversacional da Luna.
