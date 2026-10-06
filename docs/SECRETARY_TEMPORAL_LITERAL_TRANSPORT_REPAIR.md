# Recuperação limitada do transporte de provas temporais

Nota de evolução: o registro temporal foi generalizado para provas tipadas de origem em [SECRETARY_SOURCE_LITERAL_TRANSPORT_REPAIR.md](SECRETARY_SOURCE_LITERAL_TRANSPORT_REPAIR.md). Este texto preserva o desenho da etapa anterior; a versão congelada original está em `.demo/temporal-repair-before-generalization/`.

Estado: implementação local e validação offline. Este documento não declara aprovação da Golden, holdout ou staging.

## Causa observada

GF15 da Golden v10 recebeu os seletores semânticos corretos, mas Luna traduziu as provas para `Wednesday`, `4pm`, `Tuesday` e `1pm`. Essas expressões não existiam na mensagem atual. O grounding factual recusou corretamente os quatro campos; a continuação perdeu as datas, e uma mensagem residual chamou a pendência de datas de conflito de horário final.

A captura permanece intacta em `src/test/fixtures/secretary-real-wire-golden10-literal.json`, incluindo os argumentos originais e SHA-256. Nenhuma evidência ou resultado real foi reescrito.

## Contrato e autoridade

`runServicesTurn` valida a resposta inteira contra o schema LIVE publicado e valida a seleção/roteamento antes de qualquer reparo. Apenas uma prova temporal nova, estruturalmente válida e ausente como substring exata da mensagem atual permite uma chamada adicional.

A chamada adicional pede um envelope completo idêntico. A comparação estrutural permite mudanças somente nas folhas `literal` originalmente inválidas. Permanecem idênticos os valores, campos nulos, ações, ordem das ações, chaves, dependências, operação, entidade, intenção e provas já válidas. Toda prova reparada precisa existir exatamente na mensagem atual. Não há tradução ou interpretação alternativa no backend.

A segunda resposta passa novamente a validação completa. Schema inválido, chamada desconhecida/múltipla, saída incompleta, API indisponível, timeout ou prova ainda inválida encerram a interpretação sem terceira tentativa e sem entregar um patch ao domínio. A recuperação ocorre antes de `receive` e de persistência de campos. O controlador seleciona explicitamente a segunda resposta original; nenhuma resposta do provider é modificada, substituída em observadores ou reclassificada como evidência real.

Substring exata não é autorização factual. Depois da recuperação, os guards existentes ainda verificam data, calendário, horário, origem/destino, qualifiers, ambiguidade e contexto. Uma prova exata de quarta acompanhada de `weekday=6` continua bloqueada. Uma prova já exata, porém factualmente contraditória, não solicita reparo. RLS, permissões, entidades, HARD_BLOCK, confirmações, idempotência e transações permanecem no backend.

O modelo estático registrado preserva a reprodução histórica sem recuperação automática. O Agent público continua sempre no contrato LIVE; não existe downgrade por label, ambiente ou propriedade do provider.

## Chamadas e auditoria

O Runner permanece com um turno. Um `WeakMap` interno vincula o request de reparo à identidade do primeiro request; cópias, proxies, requests de outro run e concessões repetidas não herdam permissão. O wrapper comum continua limitado a uma chamada. A exceção permite exatamente duas, apenas após a primeira completar e sua auditoria terminal ser persistida.

Cada chamada tem `attempt` e `purpose` explícitos. O recorder gera identificadores próprios para STARTED/terminal por chamada, mantendo o mesmo run, sessão e tenant. Ambos são aguardados; falha de auditoria impede dispatch ou consumo. Metadata de uso passa a schema_version 2. O trace soma todas as tentativas observadas, publica propósito/tentativa e conta `transport_repair_calls`/`retries` honestamente.

O request adicional contém somente mensagens system/user e dados do envelope original. As restrições de HTTP/SDK permanecem: nenhuma conversa remota, previous response, hospedagem de ferramentas, armazenamento ou retry de cliente. O mesmo budget admite e reserva cada HTTP separadamente, antes do transporte. Os testes usam um journal temporário próprio, nunca o journal cumulativo da missão. A observabilidade passiva continua sem substituir respostas nem propagar falhas.

## Apresentação

A pergunta residual usa os papéis realmente pendentes: data de destino, data original, horários ou fim. Avisos de incompatibilidade aparecem somente quando um código correspondente está presente. Uma pendência persistida de duas datas não inventa conflito de final.

## Limites da validação

O replay LIVE offline adapta explicitamente o envelope histórico ao schema atual adicionando apenas `source_scope:null`, exigido pela evolução independente do contrato por ação. Todos os seletores e provas originais permanecem iguais. O envelope histórico sem adaptação permanece rejeitado pelo schema LIVE atual, e o replay registrado conserva seus bytes e falha original. A resposta de reparo dos testes é um contrafactual sintético, não uma nova resposta da Luna real.

A suíte cobre 1/2/5/10 ações, fidelidade de campos e grafo, recusa de alterações semânticas, literal de turno anterior, limites de identidade/chamadas, original malformado, segunda resposta inválida, falhas de auditoria/orçamento/API, observadores passivos e preservação do draft com retirada da proposta em falha. O teste de dez ações mede a requisição real serializada e exige o limite de 64 mil com o mesmo overhead de 8192.

É necessário executar novamente a Golden congelada e, depois de congelar o conjunto final, o holdout independente. Os resultados offline não provam que o modelo produzirá o reparo corretamente em todas as conversas reais.
