# Ambiguidade residual temporal: congelada para validação final

Data: 2026-09-26. Estado: congelada para validação final. O replay histórico restaurado passou 17/17 e a revisão independente final passou 8/8 após correção do fallback legado sem prova por papel. Validação integrada e Golden permanecem a cargo da execução principal. Este documento não declara staging ou Production prontos.

## Causa

GF11 v8 conservou cliente e datas, mas tratou uma interpretação de relógio 12 horas como rejeição sem preservar sua informação parcial. `temporal_missing` indicava somente quais campos faltavam; não mantinha a expressão literal, alternativas nem componente pendente. A apresentação substituía a pergunta do adapter por uma lista genérica de horários.

## Contrato

- `pending_temporal_ambiguities` é metadata backend-owned fora de `SchedulingFields`, dos valores aceitos e do histórico de rejeições.
- Cada item contém papel (`source_time`, `time` ou `end_time`), `CLOCK_DAYPART`, expressão literal e dois candidatos separados por 12 horas.
- A criação exige expressão factual única, completa, não negada e sem qualificador, com única divergência de 12 horas. Não altera a interpretação histórica de um relógio que já coincide com o literal.
- Papéis marcados internamente pelo guard como resposta curta retargetada não produzem residual. Correções explícitas legítimas de outro papel seguem o guard normal.
- Uma resposta curta precisa ser integralmente formada por átomos temporais reconhecidos e conectores. A granularidade da evidência não define intenção: uma frase de correção completa e seu trecho temporal têm o mesmo resultado.
- No caminho legado sem evidência por papel, o campo aguardado permanece conservadoramente autoritativo. Texto não temporal adicional não comprova mudança de papel. Uma correção de outro papel durante clarificação exige a evidência estruturada do novo protocolo.
- A comparação entre fragmento e evidência aplica normalização e remoção de pontuação/espaços periféricos simetricamente. Pontuação não pode transformar um papel rejeitado em nova ambiguidade.
- O draft versionado persiste o residual; seus papéis bloqueiam readiness sem virarem `temporal_missing`. Hash, revisão, expiração e confirmação permanecem exigidos.
- A resolução curta requer draft/contexto vigente, papel solicitado, valor entre os candidatos e evidência literal atual de um único período. O período é consumido pelo relógio solicitado e não entra como filtro de outro papel.
- Estado em memória só é publicado depois da persistência aceitar a revisão. Erros de revisão deixam os campos, draft e residual anteriores intactos, com proposal invalidada.
- Draft, assessment, pergunta exibida e contexto de Luna usam a mesma seleção de pergunta. Motivos literais pendentes continuam prioritários.
- A mesma lógica atende operações simples, batch e leituras dependentes. A leitura dependente continua aguardando o predecessor.

## Evidência offline

| Bateria | Resultado |
| --- | --- |
| Residual simples, contexto, atomicidade, NEW/RESUME/tenant, deferred, granularidade, normalização e fallback legado | 78/78 |
| Residual em batch, DAG, revisão, UI/contexto e negativos | 22/22 |
| Último conjunto após reparo do fallback legado: as duas suites acima e source/evidence históricos | 183/183 |
| Replay histórico de outputs imutáveis após reparo do fallback | 17/17 |
| Revisão independente final após reparo do fallback, informada pela execução principal | 8/8 |
| Regressões históricas anteriores ao último reparo em 12 suites: temporal, replay legado, ActionPlan, estado, deferred, batch e UI | 289/289; revalidação global a cargo da execução principal |
| TypeScript global, sem emitir arquivos | PASS antes do último reparo; revalidação final pela execução principal |
| ESLint em src e packages/salon-secretary/src, sem cache | PASS antes do último reparo; revalidação final pela execução principal |

O teste dedicado reproduz o provider output imutável de GF11 e verifica seu SHA. Preserva as datas de origem/destino, resolve os relógios em turnos separados e impede lookup/proposal antes da resolução necessária. O conjunto de 183 casos inclui o literal NFD verdadeiro (`a` seguido de acento combinante).

Os negativos incluem ausência de prova, candidato externo, papel errado, período contraditório, negação, múltiplos períodos, contexto expirado, revisão antiga, alteração do alvo, respostas vazias e pares de papéis diferentes. Os casos positivos incluem horários por extenso e numéricos, minutos, correção explícita e retomada autorizada.

A revisão independente durante implementação expôs e motivou regressões adicionais para:
1. Rejeição de papel errado indevidamente promovida a residual.
2. Gate excessivo que bloqueava uma correção explícita legítima de outro papel.
3. Divergência entre pergunta de motivo no backend e pergunta de horário na apresentação.
4. Período emitido pelo modelo durante resolução da origem contaminando o destino.
5. Uma evidência contendo a frase inteira classificada incorretamente como resposta curta. A fronteira agora depende da cobertura factual da mensagem, sem interpretar verbos ou comandos.
6. Pontuação removida apenas do lado da mensagem, permitindo que uma resposta curta com papel errado criasse residual. A comparação atual é simétrica.
7. O reparo da granularidade foi aplicado indevidamente também ao fallback legado sem evidência. O replay imutável de Amanda mostrou que “o primeiro das 11h” sobrescrevia o destino aceito. Restaurar a autoridade conservadora do papel aguardado nesse ramo protege respostas referenciais sem criar parser de intenção. Sete regressões falharam antes e passaram depois do reparo, incluindo quatro formulações referenciais em seis pares de papéis e preservação do draft no adapter.

Dois testes novos da etapa de implementação tinham a premissa incorreta de que uma correção textual sem prova por papel poderia substituir o papel aguardado. Foram substituídos por verificações conservadoras mais restritivas; os controles positivos de correção com evidência ampla ou atômica permanecem e passam. Nenhum expected histórico, congelado ou de Golden foi ajustado. O replay restaurado está em `.demo/historical-replay-legacy-fallback-restored.json`.

Nenhuma mensagem ou expected do Golden foi alterado por esta implementação. O holdout não foi lido. Não houve chamadas pagas, mutações operacionais ou acesso à Production nesta subetapa.

## Limites

Esta é evidência offline de correção estrutural com revisão independente concluída. A execução principal ainda precisa concluir a validação integrada/real com os bytes finais. ESLint direto foi usado porque o wrapper Next tentou apagar um cache sem permissão; a execução direta sem cache passou. Os hashes congelados estão em `.demo/residual-temporal-candidate.json`; SHA-256 do guard, confirmado também pela revisão independente: `61364b67c1a5f7784e25b0678f6be7d9c0bbe1a9437f68e7bfd22e4b291b6a17`.
