# Componentes temporais e prova transiente de papel negativo

Estado: implementação local, ainda sem transporte no SDK ou integração nos adapters. Nenhuma chamada real, banco ou autorização de release resulta desta alteração. O contrato novo precisa de revisão independente e avaliação semântica real.

## Componentes factuais

`scheduling-temporal-components.ts` reconhece deslocamentos futuros exatos de dias/semanas, relógios ancorados em meio-dia/meia-noite e extremos de um intervalo com qualificador de período compartilhado. Faz aritmética de calendário no timezone do domínio. Não escolhe intenção, entidade ou operação.

Um literal precisa conter o componente completo: minutos, unidade, direção e qualificadores adjacentes não podem ser recortados. Composições não suportadas continuam em clarificação. A prova de um extremo do intervalo não autoriza inverter seu papel ou buscar o período em uma frase desconectada. O primeiro extremo só herda o período do segundo quando ambos os valores e a prova literal do segundo corroboram essa relação.

## Papel negativo selecionado pela Luna

O novo módulo puro `scheduling-temporal-negative-context.ts` exporta `temporalNegativeContextProof`, `TemporalNegativeContextProof`, `TemporalNegativeContextBinding`, `TemporalNegativeContextInput` e `validateTemporalNegativeContext`.

```ts
type TemporalNegativeContextProof = {
  negative_context: Array<
    | { role: "OVERRIDE_CONSENT"; literal: string;
        anchor: { field: "override_requested"; value: false; literal: string } }
    | { role: "PRIOR_CALENDAR_CONDITION"; literal: string;
        anchor: { field: "date" | "source_date"; literal: string } }
  >; // de 1 a 2 provas, shape estrito
};
```

O limite atual é `appointment.create`, que já possui o domínio de exceção/slot alternativo. Não habilita cancelamento, alteração, leitura ou outra capacidade. O módulo devolve somente validação e spans de negadores, nunca valores de domínio, consentimento verdadeiro ou autorização de execução.

- Literal e âncora precisam ser atuais, exatos, únicos, lexicalmente inteiros e ligados à mesma oração. A fronteira usa code points originais Unicode, incluindo letras, números, marcas combinantes e continuações de identificador; não usa offsets de texto normalizado. Uma prova contém um único negador de seu papel; outro negador residual mantém o bloqueio.
- As provas são disjuntas entre si e das provas temporais positivas e nomes de entidades atuais/aceitos. A proteção de nomes também considera caixa e acentuação.
- Cada campo temporal fornecido precisa de prova positiva atual independente. Campos anteriores completos mais uma recusa de encaixe não reativam uma proposta sozinhos.
- Consentimento requer `raw.override_requested === false` e a dimensão fechada `sobreposição` ou `encaixe`. Não usa lista de verbos. A prova não elimina os demais guards de literal, horário, calendário, causa, permissão ou confirmação.
- Condição anterior exige uma data realmente aceita no draft vivo. A âncora pode ser dia da semana completo, ISO ou DD/MM/YYYY. Não pode esconder mês, qualificador, data ou horário adicional. O alvo novo precisa ser uma data explícita diferente, com prova própria.
- `expectedDraft` é capturado pelo backend antes da inferência. `liveDraft` é conferido no uso: mesmo ref/revision, expiry futuro, campos iguais aos aceitos e `scope_valid === true`. O adapter é responsável por tenant/user/session/item nesse vínculo. Nenhum desses IDs vem da Luna.
- Contexto ausente, inválido, expirado, cruzado ou sem prova positiva mantém falha fechada. Os metadados nunca entram em `SchedulingFields` ou no draft persistido.

Integração mínima já disponível como décimo argumento opcional, sem alterar chamadas existentes:

```ts
groundSchedulingTemporal(previous, raw, source, timezone, now,
  waitingFor, operation, temporalEvidence, ambiguityContext,
  proof == null ? undefined : {
    proof,
    binding: expectedDraft && liveDraft ? { expectedDraft, liveDraft } : undefined,
  });
```

O guard continua verificando os valores originais contra a fonte original. Não mascara o texto nem modifica a prova temporal. O resultado válido da nova validação só permite separar o negador comprovadamente contido no papel declarado. O binding é necessário para `PRIOR_CALENDAR_CONDITION`; `OVERRIDE_CONSENT` também funciona no NEW sem draft anterior.

**Pendente na integração:** um input de contexto inválido faz o guard retirar os campos temporais da projeção retornada para impedir proposta. O adapter precisa rejeitar essa prova antes de adotar a projeção, preservando fields/draft aceitos e retirando os carriers/CTA pelo boundary de falha. Não persistir essa projeção como perda de campos já aceitos. O transporte permanece desligado até a cobertura desse limite.

## Limite semântico explícito

O rótulo de papel continua sendo uma decisão semântica da Luna, assim como a intenção escolhida. Literalidade, disjunção, vínculo e aritmética não provam universalmente o sentido de uma oração. Por exemplo, `Não quero marcar por causa da sobreposição.` pode cumprir essas verificações se receber erroneamente o rótulo de recusa de encaixe. O backend não finge distinguir esse predicado por uma lista de verbos. Esse limite foi informado e aceito para a revisão do contrato puro, com gate semântico real pendente.

Uma recusa adicional demonstrável (`Não agende e não autorizo sobreposição.`) ou uma âncora em outra oração (`Não agende, só discutimos sobreposição.`) é bloqueada estruturalmente. Isso não é alegação de que toda classificação semântica errada seja impossível.

## Evidência e fronteira de replay

- Fixture original copiada do holdout já consumido: `src/test/fixtures/secretary-temporal-consumed-holdout-v2.json`, SHA256 `23f04c6566149fe13757d847c6e27a40428c307387807efa58d14c56806ff7a1`. Fontes e argumentos preservados.
- Replay original: V218 e V221 passaram após os componentes; V216 e V217 **continuam FAIL funcional e fail-closed** porque seus raws antigos não têm o novo contrato. Não houve alteração dos expected nem injeção de prova nessas capturas.
- Contrafactuais identificados como `NEW CONTRACT` adicionam uma prova sintética separada. Seu PASS é evidência do guard, não da Luna real ou do holdout original.
- Negativos históricos estão inventariados por AST em `.demo/temporal-negation-inventory.json`, com mensagens, raw/contexto, matchers e hashes.
- REDs locais preservados: `.demo/temporal-components-exactness-red.log` (7 falhas), `.demo/temporal-negative-context-boundary-red.log` (5 falhas) e `.demo/temporal-negative-context-calendar-red.log` (13 falhas). Os mesmos controles permanecem nos testes.
- `.demo/temporal-pure-new-contract-final.log`: 147/147 nos dois novos arquivos de propriedades. `.demo/temporal-pure-focused-final.log`: diagnóstico de 458 PASS / 4 FAIL, sendo os dois raws antigos pendentes e dois guards históricos `X94_UNAUTHORIZED_SOURCE_DRIFT` de `scheduling-reason-source.test.ts`. Esses guards/assertions não foram alterados nesta implementação.
- A revisão independente encontrou cinco recortes nominais indevidos de âncora (`encaixe` dentro de outra palavra e `sábado` dentro de outro nome). `.demo/temporal-negative-adversarial.red.log` preserva 34 PASS / 5 FAIL e seus 39 oracles não foram editados. A correção de fronteira está no helper, com mais 20 controles próprios Unicode: `.demo/temporal-pure-new-contract-final-v2.log`, 167/167 PASS. A repetição independente será registrada separadamente pelo revisor.

Revisão independente, integração do transporte, binding no adapter e testes semânticos reais continuam pendentes. Não promover este resultado a PASS do holdout, autorização de staging ou Production.
