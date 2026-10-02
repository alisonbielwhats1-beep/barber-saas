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
    "posicao": "primeiro" | "ultimo" | null
  },
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
