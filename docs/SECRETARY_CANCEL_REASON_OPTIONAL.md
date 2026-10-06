# Secretária: cancelar sem pedir motivo

Criado em 03/10/2026, a pedido do dono: "quando temos cancelamento, a Secretária pede motivo como obrigatório,
porém não é necessário". Decisão registrada em `DECISOES_PRODUTO.md` (03/10/2026), que também deixou o motivo
opcional na agenda (PR #134 para o `master`).

## Comportamento

Atrás da flag `SALON_SECRETARY_CANCEL_REASON_OPTIONAL` (padrão desligada; ligada no lançador da demo
`scripts/dev-agenda-test.cjs`). Desligada, fio, prompt, exemplos e comportamento são os de antes, byte a byte.

Ligada:

- **Cancelar exige só o agendamento.** `schedulingRequirements("appointment.cancel")` publica
  `["appointment_ref"]` e o lote cancelar→agendar publica `reason_required: false`
  (`src/lib/scheduling-contract.ts`).
- **Nunca pergunta o motivo.** As checagens de 3+ caracteres saem do executor
  (`scheduling-mutations.ts`), do lote (`scheduling-batch.ts`) e do plano (`secretary-action-plan.ts`).
- **Motivo dito continua literal.** A prova literal (`groundSchedulingReasons`) não muda: o motivo que o dono
  disser é gravado com as palavras dele e aparece na proposta ("Motivo: …"). Um motivo que o backend não
  consegue provar na mensagem é descartado em silêncio: não é gravado e não vira pergunta
  (`askedSourceFields`, em `scheduling-literal-source.ts`). O motivo do encaixe (`override_reason`) continua
  pendente como antes.
- **Sem motivo, sem linha "Motivo:".** As prévias de cancelamento, do lote e de cancelar→mensagem só mostram a
  linha quando há motivo (com motivo, o texto é o mesmo de antes; o digest de apresentação não muda).
- **O que a Luna lê:** o manual T14 diz "motivo opcional: só o dito, nunca inventado" no lugar de "motivo real
  obrigatório, nunca inventado"; a frase do agente diz que o motivo é opcional e não é pedido. As duas trocas
  são verificadas no carregamento do módulo. Os 17 exemplos do banco que mostram um cancelamento esperando o
  motivo (pergunta de `reason` ou plano "(falta motivo)": S046, S047, M014, R018–R023, R054, R056–R062) não são
  servidos; o banco e seu hash não mudam. O contrato registra `cancelReasonOptional: true` só com a flag.
- **Domínio:** `cancelAppointmentReliably` aceita cancelamento da equipe sem motivo e grava `cancelledReason`
  e o evento nulos (mesmo commit da agenda).

## Para o coordenador, quando a flag virar padrão

Nada da avaliação foi alterado nesta entrega. Com a flag ligada, estes itens ainda codificam a regra antiga e
precisam de migração própria (com rodada e atualização do `contract-version.json` pelo coordenador):

- Golden GF18 "cancelar sem motivo" (`free-use-golden.ts`, `free-use-golden-30.json`, `catalog.json`):
  espera pergunta e nenhuma proposta.
- Regra de nota `agenda-practice-lib.ts` (`REASON_NOT_LITERAL`): motivo gravado vazio conta como falha de
  segurança mesmo quando nenhum motivo era esperado. Um motivo inventado deve continuar falhando.
- 18 cenários que dependem da pergunta (variations V01, V02, V03, V05, V17, V27; natural N01, N02, N06, N27;
  multi-salão MD21B1, MD21N1, MD21S1, MD21T1 do template T21 "cancelar e responder o motivo") e o contrato de
  frases do holdout (`holdout-phrases.ts`, T21).
- Holdouts selados com cancelamento sem motivo: só o coordenador pode auditar.

## Testes

`src/lib/__tests__/secretary-cancel-reason-optional.test.ts`: flag desligada idêntica; flag ligada pelo
caminho real do plano (decoder, ActionPlan, adaptadores, journal) com modelo roteirizado, sem rede e sem banco:
sem motivo fica pronto para confirmar, motivo dito vai literal para a proposta, motivo não comprovado some sem
pergunta, exemplos retidos são exatamente os 17, prévia sem linha "Motivo:".
