# Secretária: polaridade e valores excluídos (C4)

28/09/2026. Recomendação 13 do relatório de arquitetura. Flag `SALON_SECRETARY_TEMPORAL_POLARITY`
(padrão desligado). Nenhuma chamada à Luna real e nenhum banco. Com a flag desligada, o wire, o prompt,
a versão do contrato e o comportamento do backend são os históricos, byte a byte.

## 1. O problema

A prova literal nega uma data ou hora quando há um negador na mesma oração do trecho citado. Isso é
conservador, mas recusa correções legítimas:

- "Passa a Amanda para 11h, não 10h" funciona com vírgula, mas "passa a amanda pra amanhã às dez não às
  onze" (voz, sem pontuação) perde data e hora: o "não" está na mesma oração.
- "às dez, não, às onze" e "terça, digo, quarta" são autocorreções.
- "qualquer horário menos 14h" nunca chegava ao backend.

## 2. Contrato (só com a flag)

Toda operação de agenda (NEW, ADD, PATCH, RESUME e o adapter isolado CURRENT) ganha, depois dos
seletores afirmados, o campo:

```
excluded: null | [{ field: date|time|source_date|source_time|end_time, value, literal }]
```

- `value` tem o formato do papel: `YYYY-MM-DD` / `HH:mm` no contrato clássico, ou o componente
  (`{kind,…}` / `{hour,minute,daypart}`) quando `SALON_SECRETARY_TEMPORAL_COMPONENTS` também está ligada.
- `literal` é o trecho com a negação e o valor excluído ("não 10h", "às dez, não", "menos 14h").
- A regra fica uma vez só, na descrição do próprio campo (recomendação 15):
  `temporalExclusionInstructions` em `packages/salon-secretary/src/temporal-polarity.ts`.
- O decoder transforma cada exclusão numa entrada de `temporal_evidence` com `excluded: value`, depois
  das entradas positivas. Nunca vira campo do ERP, nunca conflita com o seletor do papel e nunca é
  prova de valor afirmado. O literal não entra no registro de reparo pago (não custa chamada).

## 3. Prova no backend (`src/lib/scheduling-temporal-polarity.ts`)

Só estrutura, nunca intenção. Uma exclusão é **provada** quando o literal:

1. é um único trecho de tokens inteiros da mensagem (tolerante a caixa/acento, `literal-match.ts`);
2. não se sobrepõe a nenhuma prova positiva da ação nem a outra exclusão;
3. não tem fronteira de frase dentro (`.`, `;`, `!`, `?`);
4. tem exatamente um marcador: um negador (`não`, `nunca`, `jamais`, `nem`) ou um marcador de exclusão
   (`menos`, `exceto`, `digo`);
5. sem o marcador, é uma única expressão temporal do tipo do papel: só vocabulário temporal fechado e
   conectivos (sem verbo, nome ou outra palavra de conteúdo), e ela declara o valor excluído pela
   gramática do seu formato (a gramática histórica para `HH:mm`/`YYYY-MM-DD`, o verificador de
   componentes para componentes). Um relógio sem período de 1h a 7h ("às duas") exclui as duas metades;
   de 8h a 12h mantém a leitura histórica ("não às dez" exclui 10h, e 22h continua possível).

Efeitos:

- **Negador possuído.** Só o negador de uma exclusão provada deixa de negar os trechos positivos da sua
  oração (`temporalLiteralNegated(text, start, end, ignore)`, também nas leituras, na relação
  origem→destino, nas perguntas de período e de calendário e no caminho de componentes). Qualquer outro
  negador continua negando: "Não marca a Amanda amanhã às 10h, não às 11h" continua recusado, e uma
  recusa da operação nunca é possuída (o "não" dela está ligado ao verbo, que não é vocabulário temporal).
- **Posse só sem ambiguidade** (revisão de 28/09, `ownsMarker`). A estrutura provava a exclusão, mas não de que
  lado do marcador ela estava: "às dez não às onze" era aceito como 10h com uma exclusão e como 11h com a outra.
  Agora o negador só é possuído quando:
  - é o primeiro ou o último token da exclusão, sem pontuação entre ele e o próprio átomo ("não, quarta" e
    "às dez, não" ficam soltos e podem pertencer a qualquer lado);
  - nenhum trecho positivo da ação está no alcance dele, na mesma oração e sem conectivo no meio: do outro lado do
    marcador (a leitura inversa; "nem" só nega o que vem depois, então não conta) ou, para um marcador no início,
    logo depois do átomo ("não amanhã às 10h": o horário está dentro do que foi negado).
  Sem posse, vale a negação histórica da oração (a mesma resposta da flag desligada) e a telemetria marca
  `TEMPORAL_EXCLUSION_UNOWNED`. A exclusão continua provada: o valor igual a ela é recusado e o horário excluído
  não é oferecido. Uma vírgula resolve o lado: "às dez, não às onze" é 10h; "às dez não, às onze" é 11h.
  "às dez, não, às onze" (o "não" entre vírgulas) fica igual à flag desligada: a gramática histórica já não o
  lê em nenhuma das orações.
- **Irmãs.** A máscara de uma exclusão de ação irmã apaga só o átomo; o marcador fica visível para as outras
  ações (como `maskExcludedAtoms`), então o negador dela nunca some da visão de outra ação.
- **Valor afirmado igual a um excluído** (pelo próprio valor da exclusão, provada ou não; a Luna
  contradiz a si mesma): o campo é
  retirado e perguntado, com o valor de rejeição `EXCLUDED_VALUE` e a frase "Retirei o horário que você
  descartou.". Uma resposta só com exclusão ("não 10h") retira o valor aceito que ela nomeia e mantém um
  valor diferente.
- **Alternativas.** Horários de destino excluídos e provados não são oferecidos
  (`getSchedulingAvailability` e `inspectSchedulingMove` recebem o conjunto opcional).
- **Fallback por regex mantido.** Sem prova positiva, a gramática histórica decide com a guarda global
  de negação; só o átomo da exclusão provada é mascarado (o marcador fica visível), então não há
  aceitação mais fraca.
- **Multiação.** A exclusão provada de uma ação irmã é mascarada como os trechos dela; a cobertura de
  escopo conta o átomo excluído como reivindicado só quando a exclusão está provada.
- **Telemetria** (só códigos): `TEMPORAL_EXCLUSION_VERIFIED`, `TEMPORAL_EXCLUSION_<LITERAL|OVERLAP|
  SHAPE|MARKER|VALUE|FIELD>` e `TEMPORAL_EXCLUDED_AFFIRMED`.

Casos fixados em teste: V216/V217 (holdout consumido) e as duas direções de
`scheduling-temporal-negation-scope.test.ts` seguem verdes com a flag desligada; a mesma matriz ganhou casos com a
flag ligada ("não amanhã às 10h", "não pra sexta às 15h", "às dez não às onze"), que continuam recusados.
Migrações da revisão (cópias em `.demo/agenda-core/contract-migration/*.before-ownership-review.ts`): a voz sem
pontuação "às dez não às onze" (e "às 22h não às dez", "amanhã não quinta", "às 11h não às 10h") passou de aceita
para perguntada; os casos de meio-dia e de componentes usam a frase com vírgula.

## 4. Orçamento da requisição

As exclusões custam cerca de 880 bytes (4 ocorrências por wire, a definição e a descrição). O contrato
com a flag paga esse custo com a compactação por cópias emitidas
(`compactSecretaryWire(wire, emittedCopies)`): a contagem histórica também extraía, em definições de uso
único, os filhos que só existem dentro de uma definição já compartilhada. O schema resolvido é idêntico
(teste: o wire com a flag, sem `excluded`, é igual ao wire sem a flag). Com a flag desligada a contagem
histórica continua.

Medido com o diretório realista (8 + 24 nomes), 10 ativas + 50 suspensas, saída 8192:

| Formato | components | JIT | flag off | flag on | margem com a flag |
|---|---|---|---|---|---|
| estresse | não | não | 62437 | 60483 | 3517 |
| estresse | sim | não | 63048 | 61096 | 2904 |
| estresse | não | sim | 61611 | 59657 | 4343 |
| estresse | sim | sim | 62018 | 60066 | 3934 |
| continuação multiação | sim | não | 66042 | 64090 | -90 (já acima do limite antes; com JIT cabe) |
| continuação multiação | sim | sim | 62179 | 60227 | 3773 |
| resposta ao adapter | sim | não | 63687 | 61735 | 2265 |
| resposta ao adapter | sim | sim | 62464 | 60512 | 3488 |

Todo formato fica cerca de 1950 bytes menor com a flag. A mesma compactação, aplicada ao contrato padrão,
liberaria cerca de 2,7 KB em todos os perfis, mas muda a versão registrada; fica para o coordenador,
depois das baterias.

## 5. Versão do contrato

`polarity: true` só entra nas flags do contrato quando ligada; os cinco perfis registrados em
`packages/salon-secretary/contract-version.json` não mudam. Não há perfil com polaridade registrado:
o coordenador pode adicioná-lo depois das baterias (`node scripts/secretary-contract-version.cjs --write`).

## 6. Pendências

- Nenhuma avaliação com a Luna real. A leitura semântica (qual valor é afirmado e qual é excluído em
  "às dez não às onze") continua sendo da Luna; o backend só verifica a estrutura.
- Os 10 exemplos de polaridade do banco (`requires: ["polarity"]`) citam só o átomo excluído ("10",
  "amanha"); o contrato exige o trecho com o marcador. O renderizador ainda recusa `excluded` e
  `polarity` não está em `availableExampleFeatures`, então eles continuam fora das requisições. Para
  usá-los: reescrever os literais, renderizar `excluded` e registrar de novo a versão do perfil com
  exemplos.
- `supported_fields` do adapter não lista `excluded` (o schema já publica o campo).
