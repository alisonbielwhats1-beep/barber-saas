# Secretária — continuidade de horário original no staging

26/09/2026. Status: correção local validada; publicação bloqueada; staging OFF.

## Evidência e causa

No pedido manual “altere a amanda souza das 11h para amanha as 09h”, a resposta
real do modelo continha `source_time=11:00`, `day_offset=1`, `time=09:00`.
O guard de origem tratava dois horários como ambiguidade e removia ambos.
Na continuação, faltava uma rota determinística para responder `source_time`;
“11h” podia preencher o destino e deixar a pergunta original pendente.
Faltava também o rótulo desse campo, produzindo “Informe .”.

## Correção

- `scheduling-temporal-source.ts`: distingue origem/destino no padrão numérico
  explícito; valida cada valor, rejeita inversão e não inventa valor ausente.
  Resposta a campo temporal pendente não pode alterar outro horário implicitamente.
- `secretary-scheduling.ts`: resposta estrita de horário original e rótulos dos
  campos temporais; mantém estado e draft existentes.
- `salon-secretary.ts`: usa essa resposta determinística na continuação.

Nenhuma mudança de RLS, regra de conflito, horário passado, confirmação ou
HARD_BLOCK. `secretary-fast-path.ts` foi preservado byte a byte; não se alterou
gabarito histórico para acomodar a correção.

## Validação local

Nove testes adicionados em `scheduling-temporal-source.test.ts` e
`secretary-temporal-grounding.test.ts`: pedido original, inversão rejeitada,
valor ausente não inventado, resposta pendente preservando destino, alteração
indevida rejeitada, negação, parser estrito e continuidade do draft persistido.

Execução única final de `npm test -- --maxWorkers=2`: **2.695 PASS, 292 arquivos**,
início 11:44:59 BRT, duração 131,17s. `npm run lint` PASS;
`npx tsc --noEmit --incremental false` PASS; `npm run build` PASS.
O primeiro build local parou por ausência de NEXTAUTH_SECRET; o build final usou
segredo descartável de compilação e URL loopback. Nenhum segredo produtivo usado.

## Publicação e limites

Os quatro arquivos de runtime foram transferidos ao candidato isolado, com
hashes registrados em `manual-time-candidate-transfer.json`. Isso **não é deploy**.
O build do Codespace encerrou com SIGTERM. Instrumentação por strace mostrou
sinal externo no worker (`si_pid=0` no namespace); sem erro de compilação nem
evento OOM registrado. Uma execução com heap limitado a 1 GiB também foi
interrompida. A causa externa exata permanece não determinada; não atribuir ao
produto, nem classificar como PASS. Não continuar repetindo builds cegamente.

Runtime manual OFF; orçamento e journals da sessão preservados. Última
reconciliação encontrou somente 25 AuditLogs esperados desde a retomada anterior,
sem alteração operacional/Outbox. Não houve confirmação/mutation neste cenário.
E/E2 continuam com limitação conhecida; D histórico permanece UNKNOWN.
Production não acessada. Manual UX e dispositivo físico não validados.

Próximo passo: resolver o encerramento do compilador do Codespace, obter build
válido, atualizar binding do candidato, preflight e retestar somente o cenário
afetado em nova conversa. O agendamento das 11h já passou durante a investigação:
não alterar relógio/fixture para fabricar sucesso; o domínio deve informar que
não há agendamento futuro correspondente, sem trocar silenciosamente pela Amanda
das 12h e sem repetir a pergunta indefinidamente.
