# Clarificação de contradições de calendário

A Golden v9 preservou um bloqueio factual correto: o dia da semana informado
não correspondia à data absoluta. O guard descartava a data incompatível, mas
o draft e a apresentação conservavam somente o nome do campo faltante. A
pergunta genérica não explicava quais referências precisavam ser conciliadas.

`pending_calendar_conflicts` conserva um diagnóstico do backend separado de
`fields` e do histórico de valores rejeitados. Cada item identifica o papel,
o átomo temporal normalizado completo, a data absoluta com ano comprovado, o
dia da semana informado e o dia da semana factual. Uma evidência literal
recortada continua apontando para o átomo adjacente inteiro. Não se coleta o
dia da semana de outra frase ou de outro papel. Uma data errada produzida pelo
modelo, sem contradição nas palavras do usuário, não vira diagnóstico contra
o usuário. Um ano inferido pelo modelo também não prova essa contradição.

O estado é versionado no mesmo draft, participa do hash e dos campos faltantes
e impede proposal. A ordem das perguntas é motivo literal pendente, calendário,
ambiguidade de relógio e demais campos. Draft, ActionAssessment, apresentação e
contexto de Luna usam o mesmo papel e a mesma pergunta. A integração cobre ações
individuais, o batch atômico e leituras com dependências.

Uma correção explícita passa pelo guard factual existente. Uma resposta
referencial, como escolher a referência numérica, pode selecionar somente a
`calendar_date` publicada ou o `stated_weekday` publicado. Luna faz a escolha
semântica usando os seletores tipados existentes e um trecho literal integral
do turno atual. O backend não interpreta a frase para adivinhar a escolha:
vincula a seleção ao papel solicitado, draft atual, revisão, validade e escopo.
Não aceita troca simultânea de entidade ou de outro papel, nova contradição,
negação, ausência/recorte da evidência ou alternativa fora do diagnóstico.
O seletor weekday usa o resolvedor calendárico existente. `end_date` não possui
seletor weekday: nesse papel a escolha referencial cobre a data publicada;
outro dia exige uma correção temporal explícita.

Validação offline nesta alteração: 216 testes em 8 arquivos PASS, incluindo
guard temporal, evidências, domínio, contexto, ActionPlan e leituras dependentes.
Outra execução anterior passou 136 testes em 3 arquivos, incluindo os residuais
de relógio individual/batch; as contagens se sobrepõem e não devem ser somadas.
TypeScript e lint dos arquivos alterados PASS. Nenhum banco, chamada paga,
holdout ou ambiente remoto foi usado. A execução real após congelamento e a
revisão independente continuam gates separados.

Hashes do ponto de integração e comandos: `.demo/calendar-clarification-freeze.json`.

## Limite entre persistência e estado conversacional

Uma falha posterior à gravação do draft podia descartar o clone conversacional
e deixar a revisão antiga em memória. A próxima tentativa então encontrava
`REVISION_CONFLICT`. Scheduling agora publica a revisão aceita pelo journal
mesmo quando proposal ou leitura posterior falha, com proposal removida. Falhas
anteriores à confirmação da gravação conservam os campos anteriores.

O batch prepara um clone do grafo e só publica o plano retornado pelo draft.
Respostas, seleção de entidades e patches do ActionPlan seguem esse limite. Um
primeiro batch já persistido também é associado à sessão se sua primeira
proposal falhar. Isso não modifica transações, executores ou idempotência.

Validação específica final: **48/48 testes em dois arquivos PASS** (38 de
calendário e dez de persistência); lint dos 16 arquivos alterados PASS. A rodada
mais ampla concorrente teve 148 PASS e sete FAIL de transporte histórico durante
a alteração independente do boundary SDK; esses sete resultados não foram
contados como PASS nem tiveram expected alterado. A integração final deve
reexecutá-los após a migração da factory de modelos históricos.
