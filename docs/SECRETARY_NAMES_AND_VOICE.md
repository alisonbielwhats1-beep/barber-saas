# Nomes tolerantes e voz da Secretária (C3)

Criado em 28/09/2026. Três comportamentos novos, todos atrás de flags **desligadas por padrão**. Com as
flags desligadas, a busca de nomes, as perguntas, a voz nativa e o custo são os de hoje; só entra
telemetria de códigos (sem nomes nem texto).

| Flag | Padrão | O que liga |
|---|---|---|
| `SALON_SECRETARY_NAME_SUGGESTIONS` | desligada | Sugestões de nomes parecidos; nome da Luna diferente da mensagem vira confirmação |
| `SALON_SECRETARY_VOICE_CORRECTION` | desligada | Depois de ditar, sugestões de correção de nomes de profissionais e serviços na caixa de texto |
| `SALON_SECRETARY_TRANSCRIBE_ENABLED` | desligada | Microfone grava áudio e usa a transcrição GPT em vez do reconhecimento do navegador |
| `SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD` | desligada | C7: marcação nova que se sobrepõe a um horário do mesmo cliente vira pergunta (seção 5) |
| `SALON_SECRETARY_NAME_ALIASES` | desligada | D1: um nome que o dono ensinou com um clique vira proposta para confirmar (`SECRETARY_PERSISTED_STATE_AND_ALIASES.md`) |

## 1. Sugestões de nomes (`SALON_SECRETARY_NAME_SUGGESTIONS=true`)

- A busca exata/por trecho de hoje continua igual e vem primeiro: 1 resultado resolve, 2 a 20
  perguntam, mais de 20 pedem um nome mais específico.
- **Só quando ela não encontra nada**, um pontuador puro (`src/lib/name-search.ts`) compara os nomes
  do salão com o nome pedido. Ele ignora acentos, maiúsculas e partículas (da, de, do, das, dos, e) e
  compara palavra por palavra:
  - igual = 1;
  - prefixo com 3+ letras = 0,97;
  - inicial numa palavra que não é a primeira = 0,9;
  - erro de digitação limitado: nenhum até 3 letras, 1 de 4 a 7 letras, 2 com 8+ letras; uma troca de
    letras vizinhas conta como um erro.
- A nota do nome é a da pior palavra. Aparecem até 5 nomes com nota 0,80 ou mais, em ordem fixa (nota,
  nome, id). Um empate no corte vira pedido de mais detalhe; a lista nunca é cortada no meio.
- Onde os nomes são buscados (sempre no salão do usuário):
  - **Profissionais:** todos os ativos, até 100; na marcação, só os que fazem o serviço.
  - **Serviços:** todos os ativos, até 200.
  - **Clientes:** filtro SQL por uma palavra do nome que começa com as 2 primeiras letras do pedido,
    sem perfis mesclados, até 300. Acima disso a Secretária pede sobrenome ou telefone.
- **Nunca há escolha automática.** As sugestões aparecem como pergunta com botões: “Não encontrei
  “Tatiane”. Você quis dizer: 1. Tatiana Rocha…”. O clique é conferido de novo pela **mesma** função
  de sugestão, com o mesmo nome e dados atuais (`candidates.source = "suggest"`). Se o conjunto mudou,
  a resposta é `SELECTION_INVALID`.
- Caminhos cobertos: agendamento (marcar, remarcar, cancelar, bloquear, consultar), o par
  cancelar→encaixar (batch) e a busca de clientes (skill de clientes).
- Correções de texto nesse modo:
  - “não está elegível” só aparece quando o profissional existe no salão mas não faz o serviço;
  - quando o nome não existe, a mensagem é “Não encontrei esse profissional…”;
  - não aparece mais cartão de opções vazio.

### Nome da Luna diferente da mensagem

A Luna vê o diretório e pode “corrigir” um nome. Por exemplo, o usuário escreve “tatiane” e ela envia
“Tatiana”. O backend verifica se o nome enviado aparece na mensagem inteira, ignorando acentos e
partículas. Se não aparece:

- **com a flag ligada**, o nome é só uma sugestão. Mesmo 1 resultado vira pergunta com botão
  (“Confirme o cliente: você quis dizer 1. …”, `source = "confirm"`).
- O nome só é resolvido pelo clique ou quando o usuário escreve o nome. Um “sim” digitado não confirma.
- Escolher por texto num cartão comum de homônimos continua como hoje: a Luna repetir o nome exato de
  uma opção publicada conta como escolha daquela opção.
- Num cartão de sugestão ou confirmação, isso não vale: só o clique ou o nome escrito resolvem.
- A telemetria registra o booleano sempre, com a flag ligada ou desligada.

## 2. Correção de voz (`SALON_SECRETARY_VOICE_CORRECTION=true`)

- Depois do ditado nativo, a ação de servidor `suggestSecretaryDictation` compara as palavras com os
  nomes de **profissionais e serviços** do diretório (`src/lib/secretary-voice-correction.ts`).
  **Clientes nunca entram.**
- As sugestões aparecem abaixo da caixa de texto, por exemplo “Você quis dizer: Rodrigo?”. Aceitar só
  troca a palavra no texto; o envio continua manual, pelo botão Enviar.
- Algumas palavras nunca são corrigidas:
  - datas, horas e números por extenso;
  - palavras curtas em minúsculas;
  - flexões de um nome do catálogo (“cortes”);
  - palavras igualmente parecidas com dois nomes.
- Uma palavra em minúsculas só é corrigida quando divide um começo longo com o nome (“rodrigues” →
  “Rodrigo”).

## 3. Transcrição GPT: pronta, mas desligada

Decisão do dono: não testar agora, custo zero. Para ligar, **todas** as condições abaixo são
necessárias:

1. `SALON_SECRETARY_VOICE_ENABLED=true` (mostra o microfone) e `SALON_SECRETARY_TRANSCRIBE_ENABLED=true`.
2. `SALON_SECRETARY_ALLOW_PAID_CALLS=true`, com `SALON_SECRETARY_OPENAI_API_KEY` e
   `SALON_SECRETARY_OPENAI_PROJECT` configurados no painel do provedor ou no ambiente local. Nunca
   escreva chaves em documentos.
3. `SALON_SECRETARY_TRANSCRIBE_BUDGET_USD`: orçamento por salão e por mês UTC. Sem valor, é 0 e toda
   chamada é recusada. O máximo aceito é 5.
4. `SALON_SECRETARY_TRANSCRIBE_SALONS`: ids dos salões liberados, separados por vírgula. Sem lista, a
   configuração é recusada. O número de salões vezes o orçamento por salão precisa caber no teto do
   programa (US$ 25 por mês); um salão fora da lista recebe `TRANSCRIBE_DISABLED`.
5. Opcional: `SALON_SECRETARY_TRANSCRIBE_MODEL`. O padrão é `gpt-4o-mini-transcribe`; também é aceito
   `gpt-4o-transcribe`.

Como funciona (`src/lib/secretary-transcribe.ts` e a ação `transcribeSecretaryVoice`):

- O microfone grava com MediaRecorder a 24 kbit/s (cerca de 180 KB por minuto) por no máximo 60 s. O áudio vai para a ação de servidor. O
  texto transcrito volta para a caixa de texto e nunca é enviado sozinho.
- **Guarda própria:**
  - só a URL `https://api.openai.com/v1/audio/transcriptions`, com POST;
  - só os campos `file`, `model`, `language=pt`, `response_format=json` e `prompt`;
  - só os modelos da lista;
  - áudio de até 480 KB no servidor (abaixo do limite de 1 MB da ação de servidor) e até 60 s declarados;
  - a flag é relida em cada chamada.
- A guarda de custo da Luna (`openai-cost-guard.ts`) não foi alterada e continua recusando esse
  endereço.
- **O prompt tem só nomes de profissionais e serviços**, nunca de clientes.
- **Orçamento próprio:** antes da rede, cada chamada reserva o pior caso numa linha
  `SECRETARY_TRANSCRIBE/RESERVE` do AuditLog do salão, a US$ 0,02/min. O provedor cobra a duração real, que os
  segundos declarados pelo navegador não limitam: a duração cobrável é limitada pelo tamanho do arquivo na menor
  taxa dos codecs aceitos (6 kbit/s = 750 B/s), e a reserva usa o maior entre esse limite e os segundos declarados
  (no máximo 640 s, cerca de US$ 0,21, para 480 KB). A reserva é feita sob trava por salão. Não há reembolso.
- **Avaliação:** executores de avaliação podem usar a mesma função com
  `guardPaidFetch("transcribe", …, { estimator: transcriptionsEstimator })`, do
  `packages/salon-secretary/evaluation/program-spend.ts`. O estimador lacrado `transcriptions` cobra
  sempre o pior caso; um acerto por uso reportado pelo provedor nunca é aceito. O código do app não
  importa código de avaliação; a regra é fixada em `jev-evaluation.test.ts`.
- Revisão do dono antes de ligar: o preço-teto por minuto e os limites. O servidor ainda não lê a duração do
  contêiner: um arquivo Opus com DTX (silêncio abaixo de 6 kbit/s) pode durar mais do que o limite pelo tamanho.
  Antes de ligar, medir a duração no servidor (Ogg/WebM/MP4) ou aceitar esse risco dentro do teto do programa.
- Os testes usam só `fetch` simulado.

## 4. Telemetria (somente códigos)

O `outcome` da linha `SECRETARY_ROUTER` ganha dois campos:

- `name_checks`: `{role, in_message, option_echo}`.
- `name_resolution`: `{kind, outcome, n}`, com `outcome` entre MATCH, AMBIGUOUS, TOO_MANY, NO_MATCH,
  SUGGEST, DETAIL, CONFIRM e NOT_ELIGIBLE.

Os dois aparecem só quando houve verificação, têm até 16 entradas e nunca incluem nomes ou texto.

## 5. C7 (28/09/2026): nomes do diretório, artigos, tratamento e marcação nova

Correções estruturais tiradas da taxonomia de falhas da Luna real (braço `selected`). Nenhuma é regra de frase.

### Nome completo do diretório (com `SALON_SECRETARY_NAME_SUGGESTIONS`)

A Luna vê o diretório e às vezes troca o primeiro nome dito pelo nome completo ("rodrigo" → "Rodrigo Lima").
Antes, isso virava cartão de confirmação, porque "lima" não está na mensagem. Agora o nome de **profissional** ou
de **serviço** está provado quando:

- as palavras dele que o usuário escreveu, dentro do trecho da ação (`source_scope` verificado), formam um
  subconjunto das palavras de **exatamente uma** entrada do diretório do salão (todos os ativos, até 100
  profissionais e 200 serviços);
- essa entrada é o próprio nome que a Luna enviou.

Exemplos:

- "rodrigo" com um só Rodrigo no salão: provado.
- "rodrigo" com Rodrigo Lima e Rodrigo Alves: não provado; continua a confirmação, nunca escolha automática.
- "tatiane" → "Tatiana Rocha": nenhuma palavra dita, então continua sugestão.
- Serviço e profissional: as palavras dentro do nome do cliente não contam, como na prova literal. "marca a Carla
  Lima" nunca prova "Rodrigo Lima" (revisão de 28/09: antes, só o serviço apagava o nome do cliente; agora
  `withoutCustomerMentions` vale para os dois e o nome inventado continua cartão de confirmação).

Clientes não mudam: não estão no diretório da Luna. A telemetria marca `directory_proof: true` no `name_checks` (papel
`service` só aparece para essa prova). O contrato agora diz, no campo `professional_name`, "copie o nome como o usuário
escreveu" e, no `service_name`, "copie como escrito". As descrições ficaram **9 bytes menores** que as anteriores.

### Artigo e pronome de tratamento (sempre)

- **Artigo no início nunca é parte do nome.** "a carla" é buscada como "carla" (clientes e profissionais, busca exata,
  sugestões e prova do nome). Antes, `LIKE %a carla%` não achava ninguém, ou achava "Ana Carla" por engano.
- **Tratamento ("dona", "seu", "sr", "sra") é mantido na busca, mas não é exigido.** "dona cida" busca primeiro como
  foi escrito (acha a cliente cadastrada como "Dona Cida"); só quando nada aparece a busca repete sem o tratamento
  (acha "Cida Souza"). Vários resultados continuam pergunta.
- Um tratamento que a Luna acrescentou e o usuário não disse não conta como nome escrito: continua exigindo prova.
- O banco de exemplos segue a mesma política: nome sem artigo (o portão reprova `NAME_WITH_ARTICLE`) e tratamento só
  quando foi dito ("dona cida").

### Resposta de escolha não é data (sempre)

Com um cartão de opções aberto, "a segunda" é a segunda opção, não segunda-feira. Quando a resposta só repete o nome de
uma opção publicada e a Luna não mandou nenhum seletor de data, hora ou período, as palavras da resposta não
reverificam os valores já provados. Antes, "segunda" apagava a data "amanhã" já provada (`SOURCE_TEMPORAL_CONFLICT`).
Com seletor temporal da Luna, a prova literal continua completa. A escolha por `choice` (id de opção) já não passava pela
reverificação.

Revisão (28/09): a decisão também lê a **mensagem do dono** (`replyOnlyPicks`). Com as palavras do nome escolhido
mascaradas, a resposta não pode ter negador (não, nunca, jamais, nem) nem outro átomo temporal além de um único
ordinal que também é dia da semana ("a segunda", "a quinta"). "a Amanda Souza, mas não amanhã", "amanda souza. amanhã
não, sexta" e "a segunda, só que não é amanhã" voltam à prova completa, e a data negada nunca fica no rascunho. Vale
também no lote cancelar→agendar (`groundBatchPatch`).

### Marcação nova para quem já tem horário (sempre, só tela)

Quando `appointment.create` é para um cliente com horário futuro, o cartão da proposta mostra:
`Atenção: Fábio Santos já tem horário marcado: qua, 30/09 às 16h (mesmo horário). Isto cria um novo agendamento; para
mudar o existente, peça para remarcar.`

- O horário que se sobrepõe ao novo vem primeiro, com "(mesmo horário)".
- Não há pergunta extra.
- Revisão (28/09): o aviso saiu da prévia. A prévia é o `previous_response` que a Luna lê; o aviso custava 150 a 230
  bytes por proposta e punha uma instrução dentro dos dados. Agora a proposta guarda `existing_bookings` (referência,
  horário e se sobrepõe; até 6) ao lado da prévia, e só a tela monta o texto (`existingBookingNotice`, em
  `secretary-display.ts`). Agendamentos que outra ação do mesmo plano cancela ou remarca não são listados
  (`planReleasedAppointments`).
- Com `SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD=true` (desligada por padrão), um horário do mesmo cliente que se sobrepõe
  ao novo vira pergunta de horário, sem proposta.
