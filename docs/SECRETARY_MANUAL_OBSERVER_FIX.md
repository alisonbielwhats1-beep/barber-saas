# Correção do observador da sessão manual — 26/09/2026

Bug determinístico do harness de observabilidade introduzido no preparo manual,
não atribuído ao modelo, STT ou ocorrência histórica D.

BEFORE: duas Server Actions `start` com input `[]` retornaram HTTP 500 às
14:18:24Z e 14:18:30Z. Runtime: `SyntaxError: Unexpected end of JSON input`,
digest `1371115677`. Correlations `9fc7d67c-99df-4d22-a92f-e5a131e19b2a` e
`d81b7f9c-d9f3-4c60-9ded-9f37123a17a3`. Nenhuma chamada ao provider.

Causa reproduzida: o observador anexava `request.on('data')` antes do handler
assíncrono do Next. Isso antecipava o modo flowing e consumia o corpo antes de o
parser das Server Actions anexar seu consumidor. O parser recebia corpo vazio.

Correção exclusiva do wrapper remoto: observar `request.emit('data')` sem
adicionar consumidor nem iniciar flowing. Capturar bytes da resposta e
descomprimir gzip/br/deflate apenas para registrar evidência, preservando os
bytes enviados ao navegador. Login/cookies/headers continuam fora da captura.

Implementação/testes locais: `.demo/manual-request-observer.cjs` e
`.demo/manual-request-observer.test.cjs`. `node --test` = **3 PASS**:
reprodução BEFORE (consumer atrasado recebe vazio), AFTER (corpo intacto) e
resposta gzip intacta/legível. Nenhuma mudança no produto compilado ou regras.

Staging desligado antes da edição, baseline reconciliado sem alterações e
reiniciado após preflight. Mesmo build `X_pW4ibxpeH-NHIM1dIDS` e mesmo par
autorizado. Journals e orçamento da sessão original preservados.

AFTER: somente botão **Nova conversa** em conversa de verificação separada,
sem repetir mensagens do usuário. HTTP **200**, **173 ms**, input `[]`, resposta
inicial correta, correlation `38c5879c-51d8-4fdc-beaa-a628b1f0db54`, session
`6deae1bd-b4a8-41ba-a546-ce1b25c1a15e`, às 14:21:39Z. Zero paid calls,
nenhuma mutation. Captura comprimida agora registrada como JSON legível.

Evidência BEFORE/AFTER: `.demo/manual-observer-fix-evidence/ready.json` e
arquivos remotos `manual-connection-diagnostic.json`, `manual-observer-after.json`
no diretório de evidências da sessão manual. O usuário repetirá somente a
abertura/primeira mensagem. E/E2 e D histórico permanecem inalterados.
