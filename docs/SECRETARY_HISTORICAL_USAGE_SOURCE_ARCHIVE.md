# Replay das fontes anteriores à auditoria por tentativa

Os manifestos históricos de Hard Conversations e Topic14 fixam os bytes da
versão original de `src/lib/salon-secretary-usage.ts`, cujo SHA-256 é
`26873b10276859c5613ff1edac6892ffecd46c6e754d7ce0fd1e0051fb5e847e`.
O runtime atual precisa auditar separadamente as duas tentativas possíveis de
interpretação e reparo. Essa alteração torna o código atual diferente da fonte
histórica, como esperado.

Para manter o replay histórico explícito, os bytes originais foram acrescentados
aos dois arquivos de fontes arquivadas já usados exclusivamente pelos testes:
`secretary-v1-frozen-sources.json` e `secretary-front-predecessor.json`.
Os bytes foram recuperados do bundle do candidato v8 e comparados com os hashes
originais de todos os manifestos envolvidos antes da gravação. Os manifestos,
mensagens, expected, resultados capturados e asserções continuam intactos.

Isso altera somente a leitura dos bytes históricos nos testes que já usavam o
leitor de arquivo histórico. Os módulos executados continuam sendo os atuais;
os runners reais continuam recusando autorização antiga para fonte alterada.
Não foi acrescentada exceção ao gate real nem alterado um hash esperado.

Evidências de antes/depois e origem:
`.demo/historical-pre-repair-source-archive/evidence.json` e
`.demo/historical-pre-repair-source-archive/front-evidence.json`.
O bundle de origem tem SHA-256
`f980cb6ccbc8da9837e07682e6043ea3b7943df7d2e53bec8c8db7bf57101350`.
