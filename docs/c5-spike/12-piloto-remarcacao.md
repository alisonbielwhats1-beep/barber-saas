# Piloto da remarcação: especificação da E1

Base: decisões 25–31 do dono, Adendo 9 do protocolo e o resultado da E0. Esta é a fonte única para os testes, que são escritos antes do código, e para a implementação.

## 0. Princípio e proibições

**A Luna interpreta a linguagem. O código depois dela não reinterpreta o português.**

| No caminho do piloto é proibido | No caminho do piloto é permitido |
|---|---|
| Usar maiúscula, minúscula ou pontuação como prova de identidade ou de intenção. | Normalizar as **menções que a Luna extraiu** (minúsculas, sem acento, partículas de nome do `nameTokens` já existente) para buscar registros reais. |
| Usar listas de palavras (glue, classes fechadas, verbos, negadores). | Consultar registros reais do salão, sempre pelo tenant da sessão. |
| Usar citação literal como prova de identidade ou de valor. | Calcular data e hora a partir de operadores tipados e do `received_at` congelado. |
| Ler limites de cláusula, ler negação ou aplicar a gramática temporal sobre o texto do dono. | Detectar ambiguidade real: mais de um registro compatível, ou duas leituras de tempo válidas nos dados. |
| Usar o validador de fatos do Agent (`secretary-agent-validator.ts`) e o fallback para a C4. | Localizar o atendimento **uma única vez**. |
| | Verificar disponibilidade e regras pelas operações reais da agenda. |
| | **Verificação estreita de proveniência:** uma pista de origem só pode escolher entre **2 ou mais atendimentos reais** se a menção dela aparecer na mensagem (busca normalizada). Se não aparecer, a pista é ignorada e a Secretária pergunta. Essa verificação nunca descarta a ação nem muda um valor. |

## 1. Escopo e flag

- **Flag:** `SALON_SECRETARY_PILOT_RESCHEDULE=true`, desligada por padrão. Com ela desligada, o comportamento é byte a byte o atual.
  - Com ela ligada, o caminho do piloto atende **todas** as mensagens da sessão.
  - Não há loop de agente, validador do Agent, nem fallback para a C4.
  - Os portões de ambiente, papel e tenant continuam como estão.
- **Dentro do escopo:** `appointment.change` de **um** atendimento existente: dia e/ou hora e/ou profissional. O serviço é sempre mantido.
- **Fora do escopo:** cancelar, bloquear, trocar serviço, combo, recorrência, agendar, consultar, multi-ação e mensagem ao cliente.
  - **Tudo fora do escopo:** resposta clara, sem efeito.
  - **Parte fora do escopo:** a Secretária pergunta antes de propor só a parte possível.
- **Tempo:** até 15 s por chamada, 45 s no total. Uma chamada à Luna por mensagem, e no máximo um reparo de formato dentro do prazo.

## 2. Contrato da Luna: ferramenta `interpretar_remarcacao`

Esquema estrito. Toda `mencao` copia as palavras do dono como ele escreveu.

```jsonc
{
  "tipo": "remarcar" | "fora_do_escopo" | "misto" | "conversa" | "resposta",
  "resposta_a": "<questionId>" | null,          // continuação de uma pergunta aberta
  "desistir": false,                            // retirar o rascunho aberto (não é cancelar atendimento)
  "cliente": { "mencao": "<palavras do dono>" | null },
  "origem": {                                   // pistas do atendimento EXISTENTE, só as que o dono deu
    "dia": TempoDia | null, "hora": TempoHora | null,
    "profissional_mencao": string | null, "servico_mencao": string | null,
    "posicao": { "valor": "primeiro" | "ultimo", "mencao": string } | null   // revisão E1: com menção, passa pela verificação de proveniência
  },
  "aceita_parcial": true | false | null,        // só vale quando resposta_a é a pergunta de escopo; o código nunca deduz "sim"
  "destino": {
    "dia": TempoDia | null, "hora": TempoHora | null,
    "profissional": { "modo": "manter" | "nomeado" | "qualquer" | null, "mencao": string | null }
  },
  "fora_do_escopo": [ { "tipo": "cancelar"|"bloquear"|"trocar_servico"|"agendar"|"consultar"|"outra_acao"|"recorrencia"|"mensagem", "mencao": string } ]
}
TempoDia  = { "tipo": "data", "dia": 1-31, "mes": 1-12 | null, "mencao": string }
          | { "tipo": "dia_semana", "dia_semana": 1-7, "qualificador": "este" | "proximo" | null, "mencao": string }
          | { "tipo": "relativo_hoje", "dias": int, "mencao": string }
          | { "tipo": "mesmo_da_origem", "mencao": string }
          | { "tipo": "origem_mais_dias", "dias": int, "mencao": string }      // "uma semana pra frente" = 7
TempoHora = { "tipo": "relogio", "hora": 0-23, "minuto": 0-59, "periodo": "manha" | "tarde" | "noite" | null, "mencao": string }
          | { "tipo": "mesmo_da_origem", "mencao": string }
          | { "tipo": "origem_mais_minutos", "minutos": int, "mencao": string } // "duas horas e meia pra frente" = 150
          | { "tipo": "a_definir", "mencao": string }
```

- **O que a Luna recebe:**
  - a data local e o dia da semana do `received_at`;
  - o fuso do salão;
  - **os nomes da equipe e do catálogo de serviços**;
  - na continuação, o resumo do plano aberto e a pergunta pendente (`questionId`, ação, campo).
- **O que a Luna não recebe:** a lista de clientes (decisão 22).
- **O que a Luna nunca decide:** identidade final, atendimento, data calculada, disponibilidade ou aprovação.

## 3. Resolvedor determinístico

1. **Cliente:** normaliza a menção e busca no salão. Estados:

   | Estado | Quando | Resultado |
   |---|---|---|
   | **exato** | os tokens da menção são iguais aos do cadastro, e é único | vincula (`explicit`) |
   | **parcial compatível** | os tokens da menção estão contidos num cadastro único | vincula e mostra o nome completo na proposta (`explicit`) |
   | **ambíguo** | 2 ou mais compatíveis | pergunta com as opções reais |
   | **contraditório** | o candidato único não tem algum token da menção | pergunta «Encontrei X, mas você escreveu Y. É essa cliente ou outra pessoa?». **Nunca substitui** |
   | **não encontrado** | nenhum compatível | pergunta, com sugestões tolerantes reais quando existirem |
   | **busca indisponível** | a busca falhou | erro seguro, nunca "não existe" |

2. **Atendimento:** considera os atendimentos futuros (a partir do `received_at`, status PENDING ou CONFIRMED) da cliente resolvida, e filtra pelas pistas de origem (dia e hora pelo normalizador, profissional e serviço resolvidos, posição no dia).

   | Atendimentos restantes | Resultado |
   |---|---|
   | 0 | pergunta, mostrando os próximos atendimentos dela |
   | 1 | vincula (`derived`, mostrado na proposta) |
   | 2 ou mais | pergunta com as opções reais |

   Uma pista que escolhe entre 2 ou mais atendimentos passa pela verificação estreita de proveniência (§0).

3. **Data de destino**, sempre a partir do `received_at` congelado e no fuso do salão:

   | Operador | Regra |
   |---|---|
   | `data` | Sem mês: a próxima ocorrência a partir de hoje. |
   | `relativo_hoje` | hoje + n. |
   | `mesmo_da_origem` | dia do atendimento original (`inherited`). |
   | `origem_mais_dias` | dia original + n (`derived`). |
   | `dia_semana` sem qualificador | Leituras: (i) a 1ª ocorrência depois de hoje; (ii) a 1ª ocorrência depois do dia original. Se (i) ≠ (ii), a Secretária **pergunta** com as duas datas (decisão 27). |
   | `dia_semana` com "este" | A leitura (i). |
   | `dia_semana` com "proximo" | Pergunta se as duas leituras divergirem. |
   | Dia da semana igual ao de hoje (sem qualificador ou "este") | Hoje também é uma leitura, desde que a hora de destino (se já conhecida) ainda esteja depois do `received_at`. Se as leituras divergirem, pergunta. Em pistas de origem, "este" conta a partir de hoje, inclusive. |

   Revisão E1: na resposta à pergunta de escopo, `aceita_parcial` true segue só com a remarcação; false retira a ação sem efeito; null pergunta de novo.

4. **Hora de destino:**
   - **`relogio` com hora de 12 a 23, ou com período:** a hora como foi dita.
   - **`relogio` com hora de 1 a 11 e sem período:** as leituras h e h+12 são filtradas pelo expediente do profissional ou do salão naquele dia (decisão 18).
     - Sobra 1: usa (`derived`, mostrada na proposta).
     - Sobram 2: pergunta.
     - Sobra 0: pergunta.
   - **`mesmo_da_origem`:** a hora original (`inherited`).
   - **`origem_mais_minutos`:** a hora original + n (`derived`).
   - **`a_definir`:** pergunta a hora.

5. **Profissional:**

   | Modo | Resultado |
   |---|---|
   | `manter` ou não informado | o profissional atual (`inherited`) |
   | `nomeado` | resolvido na equipe, com os mesmos estados do cliente (`explicit`) |
   | `qualquer` | regra da decisão 15 (`derived`, mostrado); se ninguém estiver livre, pergunta |

6. **Serviço:** sempre o atual (`inherited`).

7. **Regras da agenda** (conflito, expediente, se o profissional faz o serviço, duração, preço): só pelas operações reais, ao montar a proposta. Se uma regra for violada, não há proposta; a Secretária explica e pergunta outro horário ou outro profissional, e mantém o que já foi resolvido.

## 4. Estado do plano (redutor)

```
plan { planId, revision, action: { actionId: "a1", status, fields, questions[], proposal? }, turns[] }
status: draft | pending | proposal_ready | approved | executing | done | withdrawn | needs_review
fields.{customer, appointment, date, time, professional, service} = { value, display, provenance: explicit|inherited|derived|unresolved, mencao? }
question = { questionId, actionId, field, options?, revision, open }
```

- **Uma resposta** (`resposta_a` igual a uma pergunta aberta) só preenche **aquele campo** daquela ação.
- **Uma correção** independente vira um patch com os campos dela.
- **Pergunta já fechada ou de outra revisão:** nada muda e a Secretária pergunta de novo.
- **Aceitação de patch:** só com `baseRevision` igual à revisão atual (comparação de versão). Toda mudança aceita gera revision+1 e invalida a proposta e a aprovação anteriores.
- **`desistir`:** a ação vira `withdrawn`, sem efeito na agenda. Se vier junto com uma correção, vale o rascunho corrigido, com nova revisão; o valor antigo nunca é gravado.
- **`received_at`:** é congelado por turno e guardado no turno.
- **Turno idempotente:** o mesmo `clientTurnId` devolve o resultado guardado, sem nova chamada à Luna (coluna `clientTurnId` da 027, só no banco local).

## 5. Proposta, Confirmar e gravação

- **Proposta:** pelas operações reais da agenda (`requestStaffReschedule` / `prepare` de alteração), com o **atendimento já resolvido**. A preparação não localiza de novo: atrás da flag, ela mantém o `appointment_ref` do piloto, hoje descartado em `prepareResolvedScheduling`.
- **Texto da proposta:**
  - identidade completa;
  - serviço e profissional;
  - ANTES e DEPOIS;
  - duração e preço inalterados;
  - suposições derivadas;
  - «O cliente será avisado da remarcação.» (decisão 31).
- **Confirmar:** `proposal_ref` + `draft_revision` + revisão do plano, como já existe. Antes de gravar, a Secretária confere o horário de novo, com trava e snapshot. A gravação gera recibo no journal e é idempotente.
- **Confirmar repetido depois de tempo esgotado:** consulta primeiro o recibo do `proposal_ref`, e só depois aplica as regras de expiração.
- **Falha da Luna** (tempo esgotado ou formato inválido depois do reparo): «Não consegui entender com segurança; nada foi alterado.» Os campos já resolvidos são preservados. Não há C4.

## 6. Telemetria (só códigos)

`turnId`, `planId`/revisão, `questionId`, `proposal_ref`, recibo, proveniência por campo, latência, custo e o motivo de cada pergunta.

## 7. Testes, escritos antes da implementação

**Unidade** (funções puras, leitor em memória):
- resolvedor de cliente, nos 6 estados;
- atendimento (0, 1 ou vários; posição; proveniência estreita);
- normalizador de data e hora, todos os operadores, decisão 27 e decisão 18;
- profissional (manter, nomeado, qualquer);
- redutor (resposta presa à pergunta, correção, pergunta velha, comparação de versão, desistir mais corrigir, revisão invalida proposta);
- mudar maiúsculas, acentos ou palavras de contexto na menção não muda a identidade, a não ser que a menção mude de verdade;
- todo campo tem proveniência.

**Integração** (SalonSecretary com modelo stub que devolve o contrato tipado, banco local 55441):
- o fluxo «Remarque a Ana com Carlos para sexta às 15h»: localiza, mostra antes e depois, confirma e altera **exatamente** o registro certo; as outras linhas e os outros tenants ficam intactos;
- duas Anas;
- sobrenome incompatível;
- horário ocupado (antes da proposta, e depois dela, na confirmação);
- correção para 16h;
- troca de profissional;
- desistir e corrigir na mesma mensagem;
- resposta atrasada ou de outra pergunta;
- Confirmar velho;
- mensagem repetida (mesmo `clientTurnId`);
- Confirmar repetido;
- tempo esgotado depois da gravação, resolvido pelo recibo;
- pedido em parte fora do escopo, que pergunta;
- pedido todo fora do escopo, com resposta clara;
- aviso ao cliente presente na proposta;
- com a flag desligada, tudo idêntico ao atual.

## 8. Fora da E1

Consultar, agendar, multi-ação, cancelar, bloquear, trocar serviço, voz, novo desenho da interface e produção.

## 9. Revisão final da E1 (correções, ainda atrás da flag)

- **Proveniência por turno:** cada pista de origem é conferida uma vez, contra a mensagem que a trouxe. Uma pista sem prova nunca substitui uma pista provada do mesmo campo. Um atendimento já vinculado só é localizado de novo quando uma pista provada muda de valor; outras palavras para o mesmo valor não contam. Se o vinculado continua entre os que sobram, ele fica.
- **Dia do turno:** cada operador de dia guarda o `received_at` do turno em que foi dito. Um turno posterior não o desloca; se o dia já passou, a Secretária pergunta.
- **O que a mensagem muda:** uma correção, uma desistência com correção e uma mensagem sem mudança são decididas pelos operadores da própria mensagem, nunca por uma nova resolução. Uma mensagem que não muda nada mantém a revisão e a proposta.
- **Fora do escopo:** a parte fora do escopo nunca some em silêncio. Ela vira a pergunta de escopo, inclusive numa desistência com correção, ou um aviso na resposta. Depois do sim à pergunta de escopo, ela não é perguntada de novo.
- **Contrato:** a mensagem tem uma única remarcação; uma segunda vai em `fora_do_escopo` como `outra_acao` (`misto`). As menções de nome levam só o nome. Há um novo operador de dia: `{ "tipo": "mes_relativo", "dia": 1-31, "meses": 0-12, "mencao": string }`.
- **Recibo primeiro:** antes de expirar, retirar ou preparar de novo a proposta do plano, e antes da revisão e da impressão digital do Confirmar, a Secretária consulta o recibo do `proposal_ref` do plano. Uma gravação já feita é informada como feita. Se o journal não pode ser lido, nada é retirado.
- **Mensagem repetida:** o mesmo `clientTurnId` devolve a resposta guardada só enquanto o plano é o mesmo. Se o plano mudou, devolve o estado atual.
- **Toque:** cada toque nomeia a pergunta (`<questionId>/<id da opção>`). Um toque num profissional vincula esse registro. Um toque recusado não muda nada e conta como turno da sessão.
- **Execução paga:** `--run-cap-usd` limita o gasto da própria execução antes de cada chamada (`AGENDA_RUN_SPEND_CAP`). O braço do piloto registra o progresso do plano e as opções reais da pergunta e pode tocar nelas.

## 10. E2-A (Adendo 10): as três causas do gate, sem capacidade nova

Ao §2 e ao §3, nesta ordem de precedência:

1. **Semântica de `fora_do_escopo`.**
   - Um item de `fora_do_escopo` só existe quando o dono **pede uma ação separada**, com efeito próprio, que ele quer que a Secretária faça **além** desta remarcação. Pode ser na agenda (cancelar, bloquear, agendar, trocar serviço, repetir), numa comunicação (recado ao cliente) ou uma consulta pedida **por si**.
   - **Fica dentro da remarcação**, e nunca vai para `fora_do_escopo`:
     - o motivo, o contexto e as cortesias;
     - as correções da própria remarcação ("às 10, não, às 11");
     - as referências ao atendimento (quem, qual, de quando, com quem, qual serviço);
     - as condições da remarcação ("se tiver vaga", "vê se cabe", "mantém o mesmo profissional");
     - as informações sobre a cliente;
     - uma verificação de disponibilidade que serve à própria remarcação.
   - O contrato ganha **`observacoes: string[]`** (até 6 itens de até 120 caracteres, cada um copiado da mensagem). É um lugar explícito para motivo e contexto.
     - O código **nunca** lê nem interpreta `observacoes`; elas entram só na telemetria, como contagem.
     - `fora_do_escopo` passa a exigir, por item, `pedido` com as palavras do pedido separado (no lugar de `mencao`).
   - A semântica fica na descrição do esquema e no prompt, com **exemplos inventados** e contraexemplos adversariais:
     - contexto que parece ação, mas não é;
     - ação real que parece contexto.
   - O código continua sem ler o português. A detecção de ação real fora do escopo continua obrigatória, e a pergunta de escopo continua igual.
2. **Dia da semana.** `dia_semana` passa a ser o enum `"segunda"|"terca"|"quarta"|"quinta"|"sexta"|"sabado"|"domingo"`, em origem e destino, sem número.
   - O código converte o valor tipado do enum no dia da semana. Isso é tabela de dados, não leitura do português.
   - Calcula a data a partir do `received_at` congelado, no fuso do salão.
   - As regras da decisão 27 e da "este"/"proximo"/hoje (§3) não mudam.
3. **Serviço como pista do atendimento.** `origem.servico_mencao` vira `origem.servico: { "mencao": string, "catalogo": string[] } | null`.
   - `catalogo` traz os nomes **exatos** do catálogo enviado à Luna que a menção pode designar: um ou mais, ou vazio se nenhum couber. A Luna interpreta; o código só confere fatos.
   - **Nomes:** valem só os de `catalogo` que existem exatamente no catálogo do salão (comparação normalizada de caixa e acento, nome contra nome). Um nome desconhecido é descartado.
   - **Menção:** a verificação estreita de proveniência vale para `mencao`.
   - **Filtragem:** os atendimentos futuros da cliente são filtrados pelos ids desses serviços.

   | Resultado | Ação |
   |---|---|
   | Um atendimento compatível | Resolve (`derived`, mostrado). |
   | Dois ou mais compatíveis | Pergunta, com as opções reais. |
   | Nenhum compatível, ou o serviço contradiz o atendimento indicado pelas outras pistas | Pergunta, mostrando os atendimentos dela. |
   | Lista vazia ou só nomes desconhecidos | A pista não decide nada: se ela era necessária para escolher, pergunta. |

   - A antiga comparação por tokens do nome do serviço sai.
   - Não há similaridade textual em nenhum ponto.

### 10.4 Revisão adversarial da E2-A (antes da bateria, ainda atrás da flag)

Emendas ao §10, cada uma com teste de regressão escrito antes do código. Nenhuma lê o português do dono depois da Luna.

- **Serviço sem nome do catálogo (PRINCIPLE-1; substitui a última linha da tabela do §10.3):** com a menção provada na mensagem, uma lista vazia ou só de nomes desconhecidos não casa com atendimento nenhum. A Secretária pergunta, mostrando os atendimentos dela, mesmo quando ela tem um só. Uma menção sem prova continua ignorada.
- **Atendimento com vários serviços (SERVICE-1):** a pista de serviço confere todos os serviços do atendimento (o principal e o de cada item), sempre por id exato.
- **Resposta a uma pergunta de atendimento (FLOW-1):** é resolvida só entre as opções daquela pergunta, pelas pistas da própria resposta, provadas nela. Essas pistas substituem as pendentes.
  - Uma opção compatível: vincula.
  - Várias: pergunta entre elas.
  - Nenhuma: pergunta de novo.
  - Resposta sem pista provada nunca escolhe: pergunta de novo.
- **observacoes (OBS-1; substitui o limite do §10.1):** até 20 itens, cada um até o limite da própria mensagem (1000 caracteres). Um campo que o código não lê nunca derruba o turno.
- **Limites ditos no prompt (CONTRACT-1):** no máximo 20 trechos em observacoes e 10 nomes em catalogo. Se mais de 10 couberem, catalogo vem vazio e a Secretária pergunta.
- **Reparo de formato (REPAIR-1):** cada código de regra tem uma frase fixa, escrita pelos desenvolvedores, com as saídas possíveis. Para misto: um pedido separado em fora_do_escopo, ou tipo remarcar com o contexto em observacoes. A nota nunca traz texto do modelo, e as frases entram na versão do contrato.
- **Semântica de fora_do_escopo (SEMANTICS-1/2/3):** no prompt e na descrição do esquema, com três exemplos inventados novos.
  - O sistema já avisa o cliente de toda remarcação (decisão 31). Avisar este cliente desta mudança é parte dela; um recado com outro conteúdo, ou para outra pessoa, é pedido separado.
  - Tirar o atendimento da mesma cliente de um horário para pôr em outro, com quaisquer palavras, é esta remarcação (decisão 4). Cancelar só é pedido separado quando o atendimento sai sem novo horário, ou quando é outro atendimento.
  - Um desejo do cliente repassado pelo dono, para o salão fazer algo além do dia, do horário ou do profissional deste atendimento, é pedido separado. Uma preferência ou informação que não pede nada fica em observacoes. Não há regra de desempate a favor de fora_do_escopo.
- **Catálogo enviado à Luna (CATALOG-1):** todos os nomes que o leitor devolve (até 400), cortados só acima de um orçamento de bytes da requisição. O corte é contado na telemetria.
- **Bateria DEV (REGRESSION-2):** não compartilha nome, nome de catálogo, 3-grama de conteúdo nem par de palavras de conteúdo com os exemplos do prompt. Um teste confere.

## 11. E2-B (Adendo 11): âncora temporal explícita e delegação de profissional

1. **Deslocamento com âncora** (substitui `relativo_hoje`, `origem_mais_dias` e `origem_mais_minutos`; `data`, `dia_semana` (enum), `mes_relativo`, `mesmo_da_origem`, `relogio` e `a_definir` não mudam):
   - **Dia:**
     ```
     { "tipo": "deslocamento", "quantidade": int, "unidade": "dias"|"semanas",
       "ancoras": ("origem"|"hoje"|"data_citada")[1..2], "data_citada": { "dia": 1-31, "mes": 1-12|null, "mencao": string } | null,
       "mencao": string }
     ```
   - **Hora:**
     ```
     { "tipo": "deslocamento", "minutos": int, "ancoras": ("origem"|"agora")[1..2], "mencao": string }
     ```
   - **Cálculo:** a Luna diz a operação e a(s) âncora(s) plausível(is); não calcula. O código calcula cada leitura:
     - **origem:** a data ou hora do atendimento;
     - **hoje/agora:** o `received_at` congelado no fuso do salão;
     - **data_citada:** a data literal, calculada como o operador `data`.
   - **Uma âncora:** usa (`derived`, mostrada na proposta).
   - **Duas âncoras:** se as leituras coincidem, usa. Se divergem, **pergunta** com as duas datas ou horas reais, presa ao campo `date` ou `time` (motivo `ANCHOR_TWO_READINGS`).
   - **Âncora `data_citada` sem `data_citada`, ou o contrário:** o contrato é inválido, e cabe um único reparo.
   - **Limites:** os mesmos de antes (±366 dias, ±1440 min). Uma data passada continua sendo perguntada.
   - **Estado antigo** (só no banco local): o carregador converte `relativo_hoje → hoje`, `origem_mais_dias → origem`, `origem_mais_minutos → origem`.
2. **Delegação de profissional:** `profissional.modo` ganha `"outro"`. A Luna marca a intenção ("qualquer" = quem estiver livre, inclusive o atual; "outro" = alguém diferente do atual). O código aplica a decisão 15:
   - **Candidatos:** quem faz o serviço e está livre durante toda a duração no horário de destino (o próprio atendimento é afastado).
   - **Exclusão do atual:** o profissional atual sai se o modo for `outro`, ou se o destino tiver o mesmo dia e hora da origem (senão não haveria mudança; é um fato, não leitura).
   - **Desempate:** menos atendimentos no dia, depois a ordem do nome. Deixa de existir a preferência pelo profissional atual. A proposta diz quem foi escolhido.
   - **Ninguém livre:** pergunta (`PROFESSIONAL_NOBODY_FREE`), mantendo o resto do plano.
   - **"manter" e "nomeado":** não mudam.
