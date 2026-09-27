# Ultimate 10 — modo exclusivo de revalidação u01

O modo de avaliação `--revalidate-u01` foi preparado **sem inferência**. Ele não altera o manifest, o runtime nem a tentativa histórica. `--preflight-revalidate-u01` é somente leitura; o `--preflight` original continua exigindo journal vazio e, com a tentativa histórica presente, retorna `ULTIMATE10_JOURNAL_NOT_EMPTY`.

O manifest permanece em SHA-256 `482b4fdfbf38e70da00e3507b6fb7e7167e66bdc40428c8f7767991cce077fb0`. O journal histórico `results/ultimate-10.jsonl` tem SHA-256 `9030451287e796920c346396a9dcd7b63661d3761ccae40ea8f61884dfee96c9`, dez eventos exclusivamente de u01, um `BEFORE_NETWORK`, HTTP 200 com request ID `req_fdcc0a46fe504c41b87af68be6e04e08`, `INCONCLUSIVE` e `STOPPED`. O verificador exige o hash dos bytes, a cadeia do `DurableJournal` e essa estrutura exata. Não aceita journal vazio, u02–u10, conclusão histórica ou evento adicional.

A baseline das dez fixtures tem SHA-256 `be9e96bf1a7a29464a725c5faca0d7216d176103a5259db782647add068c2135`; o dump preparado tem SHA-256 `28a58bde883a49eabce86b010fb2902aabe0aa64d27185b77b95de545234c02f`. O preflight compara hashes e contagens operacionais de todas as dez fixtures com a baseline, confirma Outbox e confirmações zero, e exige para u01 exatamente três AuditLogs técnicos com hash `428baaea66989b48bc824ac22557da919f00fbc516b40beeabe9ff4cb3ffdf3c`. As outras nove fixtures exigem zero AuditLogs próprios. Também executa a verificação de role runtime, RLS/FORCE RLS e isolamento tenant do harness existente.

A revalidação, quando autorizada em Gate futuro, escreverá em **novo** `results/ultimate-10-revalidation-u01.jsonl`, vinculado ao hash do manifest. `STARTED` carrega `attempt=REVALIDATION_U01`. O journal original nunca é aberto para escrita. O novo journal aceita apenas `u01`, um turno e um `BEFORE_NETWORK`; qualquer conteúdo prévio impede segunda revalidação. O guard da rede exige ainda `activeCase=u01`, `turn=1`, zero requests e zero witnesses anteriores. O cursor contém somente u01, e o loop termina antes de u02 mesmo após uma resposta normal. A witness, observação, checkpoints pós-HTTP, fsync, contadores e `finally` que restaura paid/Router false são os mesmos do runner aprovado. Uma falha de transporte isolada permanece `INCONCLUSIVE` e encerra esta revalidação, sem avançar.

O CLI exige as duas flags de aprovação **somente no processo** para a execução futura: `ULTIMATE10_REAL_EXECUTION_APPROVED=true` e `ULTIMATE10_REVALIDATE_U01_APPROVED=true`. Paid calls entra como false e só é ativado pelo runner após o preflight. O máximo é um caso, um turno, uma request GPT-6 Luna e reserva US$0,0086 pela tarifa congelada; zero JEV, retries, confirmações e efeitos operacionais. `COMPLETED` retorna código 0; `STOPPED` e falha de preflight retornam não zero. A tarifa e as credenciais devem ser reconfirmadas no Gate de execução.

Comando somente leitura executado neste Gate:

```powershell
node scripts/run-ultimate-10.cjs --preflight-revalidate-u01
```

Resultado: `ULTIMATE10_REVALIDATE_U01_PREFLIGHT_OK`, um caso/um turno, banco descartável em `127.0.0.1:55441/everflair_service_mvp`, role `mvp_service_runtime`, 19 tabelas RLS/FORCE RLS, hashes aprovados, nenhuma chamada de IA. O preflight normal foi repetido e continuou rejeitando o journal não vazio. O modo de execução `--revalidate-u01` **não foi invocado**.

Plano do próximo Gate, ainda **não executado**: reconfirmar a tarifa e repetir `--preflight-revalidate-u01`; então, com autorização específica, definir `ULTIMATE10_REAL_EXECUTION_APPROVED=true` e `ULTIMATE10_REVALIDATE_U01_APPROVED=true` somente no processo controlado e chamar `node scripts/run-ultimate-10.cjs --revalidate-u01`. O runner liga paid calls apenas depois do preflight e o restaura para false no `finally`. Qualquer `STOPPED` encerra a tentativa sem retry ou avanço para u02.

Rollback de código: remover apenas o modo contextual do CLI, harness, runner e seus testes, preservando integralmente o manifest, a baseline, o dump, o journal histórico e qualquer futuro journal de revalidação. Paid calls e Router permanecem false. Nunca limpar a tentativa histórica para reutilizar `--execute`.
