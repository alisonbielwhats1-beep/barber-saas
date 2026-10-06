# Secretária — backlog da Candidata 4

Registrado em 28/09/2026 (23h58), durante a prova final da candidata `67c9c297f43e0d98`, a pedido do dono.
**Nada deste documento foi implementado.** A candidata atual e a rodada do Multi-salão V3 não foram alteradas.
Este arquivo fica em `docs/`, fora do hash da candidata.

## 0. Desambiguação de horários pelos fatos do estabelecimento (pedido do dono, 29/09 00h)

### Problema observado na prova

A Secretária pergunta "02h ou 14h?" / "03h ou 15h?" mesmo quando o salão nem funciona de madrugada. Exemplos:
- owner OM09: "passa a Amanda pras 2 e o João pras 3" → pergunta dupla de meio período e, na prova, loop;
- O102: "coloca umas 4";
- OM30: "das 6 em diante".

Hoje a regra é fixa: horas 1–7 sem período sempre perguntam (`UNSPECIFIED_DAYPART_ASKED_HOURS`).

### Regra estrutural a avaliar

1. A Luna identifica as leituras plausíveis da hora (componente `daypart: UNSPECIFIED` → 02h e 14h). A Luna não escolhe.
2. O backend elimina as leituras impossíveis usando os fatos **do tenant**, nunca uma tabela fixa:
   - horário real de funcionamento do estabelecimento naquele dia;
   - jornada do profissional (aberturas/escala);
   - exceções e bloqueios aplicáveis (fechamento do salão, folga, bloqueio de agenda);
   - para um bloqueio ou intervalo: coerência com a outra ponta ("das 11 até as duas": o fim antes do início é impossível).
3. Sobrou exatamente 1 leitura → usar sem perguntar (a proposta mostra a hora; nada grava sem Confirmar).
4. Sobraram 2 ou mais → perguntar, como hoje.
5. Não sobrou nenhuma → **informar indisponibilidade e oferecer alternativas**; nunca escolher a "menos impossível".
6. Período dito pelo dono ("de manhã", "à tarde", "à noite", "da madrugada") prevalece e nunca é contradito em silêncio. Se o
   período dito é impossível no salão, isso é informado.

**Proibido:** regra fixa "2 = 14h". O exemplo do dono (salão aberto 08h–20h: "passa a Bianca pras 2 e o Rafael pras 3" →
14h e 15h sem perguntar) precisa sair dos dados do tenant; num estúdio noturno ou 24h o mesmo texto continua perguntando.

### Adversariais obrigatórios (antes de qualquer prova)

- Salão 08h–20h, profissional só de manhã (08h–12h): "pras 2" → nenhuma leitura cabe na jornada → indisponível + alternativas;
  **nunca** 14h com outro profissional nem 02h.
- Estúdio noturno (18h–03h): "às 2" → 02h válido e 14h fechado → 02h (a regra não pode favorecer a tarde).
- Salão 24h ou com as duas leituras abertas → pergunta.
- Dia com o salão fechado → "o salão está fechado nesse dia", sem escolher leitura.
- Bloqueio/folga cobrindo uma das leituras: a leitura bloqueada não conta como possível para **marcar**. Para **bloquear agenda**,
  a regra de possibilidade é outra (bloquear dentro do expediente) e precisa de teste próprio.
- Período explícito que contradiz ("às 2 da manhã" num salão diurno) → informa que está fechado, não troca para 14h.
- Intervalos: "das 11 até as duas" → 11h–14h; "das 2 às 6" num salão 08h–20h → 14h–18h; "das 10 às 2" num noturno → pergunta
  quando as duas leituras fazem sentido.
- Multi-ação: cada ação resolve pela jornada do **seu** profissional (duas ações no mesmo texto podem ter resultados diferentes).
- Evidência: a resolução fica registrada (códigos `DAYPART_RESOLVED_BY_HOURS` etc.), para auditoria e para o dono ver por que
  não houve pergunta.

## 0b. Alterar dados de um agendamento existente (levantado pelo dono em 29/09)

### Situação na candidata 67c9c297

- **Trocar serviço de um agendamento: bloqueado de propósito.** A instrução da Luna diz "Não alterar serviço/profissional de um
  agendamento." (`packages/salon-secretary/src/skill-registry.ts:56`). "Troque o serviço do Alison para barba e pezinho" hoje termina
  em capacidade indisponível ou pergunta. Nada é gravado errado, mas o pedido não é resolvido.
- **Vários serviços num agendamento: não suportado pela Secretária.** A criação usa `serviceIds:[s.service_ref]`
  (`src/lib/scheduling-actions.ts:63`).
- **Sem cobertura de avaliação.** Nenhuma bateria, nem o Golden, nem o banco de exemplos tem "trocar/adicionar serviço".
- **O domínio já suporta.** `requestStaffReschedule` recebe `serviceIds` e `professionalId` (`src/lib/scheduling-mutations.ts:143`),
  então a lacuna está só na camada da Secretária, junto com a troca de profissional (E1).

### Capacidade proposta: "alterar dados de um agendamento"

Cobertura:
- trocar, adicionar ou remover serviço;
- trocar profissional;
- agendamento novo com mais de um serviço ("corte e barba").

Garantias:
- A proposta mostra ANTES → DEPOIS com serviços, **preço e duração novos**.
- A disponibilidade é checada de novo, porque a duração muda: conflitos e HARD_BLOCK seguem as regras atuais.
- O profissional precisa atender todos os serviços; se não atende, pergunta ou oferece quem atende.
- Serviço não encontrado ou ambíguo → pergunta com sugestões. Nunca escolher sozinho.
- Nada grava sem Confirmar. Idempotência e versão do agendamento como na remarcação.

Adversariais:
- serviço inexistente;
- serviço que o profissional não faz;
- duração nova que colide com o próximo cliente;
- "tira o único serviço";
- remover um serviço que o agendamento não tem;
- homônimos de serviço ("Corte" vs "Corte infantil");
- negação ("não troca a barba").

Testes usam serviços variados de vários tipos de estabelecimento: barbearia ("pezinho", "barba", "sobrancelha"), esmalteria, estética,
cílios, spa.

## 1. Diversidade de nomes (pedido do dono)

### Problema

Os mesmos nomes aparecem demais no desenvolvimento, e isso pode criar viés e dificultar provar generalização.

- **Fixture base das baterias DEV V/N e das práticas A/B/C** (`scenarioFixture` em `agenda-practice.ts`):
  - clientes Amanda Souza, João Pereira, Fábio Santos, Carla Mendes e Rosa Viana;
  - profissionais Tatiana Rocha, Ricardo Alves e Rodrigo Lima.
- **Golden:** Lara Matos, Nina e Célia Prado, entre outros.
- **Banco de exemplos:** já usa `{cliente}`, `{profissional}` e `{servico}` desde a Fase 4, mas o pool que preenche os exemplos
  (`packages/salon-secretary/src/examples/names.json`) é pequeno.
- **Gerador multi-salão:** já sorteia nomes de pools separados para dev e holdout. As baterias escritas à mão não usam esse gerador.

### O que a Candidata 4 deve fazer

1. Aumentar bastante a diversidade de nomes de clientes e profissionais.
2. Evitar reutilizar os mesmos nomes entre o banco de exemplos e as baterias quando o nome não é a propriedade testada.
3. Usar nomes brasileiros variados:
   - compostos (Maria Eduarda, João Vítor);
   - curtos (Lia, Téo);
   - estrangeiros (Kevin, Yasmin, Hiroshi);
   - apelidos (Duda, Nando, Bia);
   - nomes que também são palavras (Rosa, Luz, Vitória, Céu, Branca, Jade).
4. Variar gênero e estrutura do nome, **sem inferir gênero pelo nome**. Frases com "ela/ele" continuam vindo do texto do dono,
   nunca de um palpite sobre o nome.
5. Incluir nomes parecidos entre si para testar desambiguação: Ana/Anna/Ana Paula, Luiz/Luís, Rafael/Rafaela, Gabriel/Gabriela.
6. Parametrizar/sortear nomes sempre que a identidade específica não fizer parte da propriedade testada. A estrutura ensinada e
   testada é `{CLIENTE} + {PROFISSIONAL} + {SERVIÇO} + {DATA/HORA}`, não personagens recorrentes. O sorteio é determinístico por
   semente e registrado no resultado, para o pass^k continuar pareável.
6b. Variar também serviços e tipos de estabelecimento (barbearia, salão, esmalteria, estética, sobrancelha/cílios, spa,
   estúdio noturno), com horários de funcionamento e jornadas diferentes, o que também alimenta a regra da seção 0.
7. Manter nomes fixos só onde a regressão histórica exige (Golden 30, fixtures `argumentsSha256`, casos com homônimo de nome
   específico). Cada exceção fica listada com o motivo.
8. Manter os holdouts selados (`D:/Projetos/secretary-holdout-sealed`, `D:/Projetos/secretary-validation`) totalmente fora dessa
   geração: nenhum pool novo é derivado deles, e o gerador continua excluindo os nomes já vistos no repositório.

### Medição obrigatória antes da próxima prova

Um script offline (sem rede, sem banco) gera um relatório com **só nomes e contagens, nunca frases**. Para cada corpus (banco de
exemplos preenchido, baterias DEV, fixtures, Golden, gerador dev e novas baterias):

- **concentração:**
  - participação dos 5 e dos 10 nomes mais frequentes;
  - entropia normalizada;
  - número de nomes distintos por 100 ocorrências;
- **overlap entre corpora:**
  - Jaccard dos conjuntos de nomes;
  - fração das ocorrências de um corpus cujo nome aparece no outro;
- **cobertura por categoria:** composto, curto, estrangeiro, apelido, nome-palavra e pares parecidos.

Meta a fixar antes da prova: nenhum nome acima de ~3% das ocorrências fora das regressões históricas, e overlap banco × DEV
perto de zero onde o nome não é o objeto do teste. Esse relatório é reportado ao dono **antes** da próxima prova.

## 2. Plano da Candidata 4

Consolidado em 29/09/2026 depois de encerradas todas as provas. Fontes:
- análise de falhas: 6 analistas + revisor adversarial + síntese; os trechos analisados estão em `.demo/agenda-core/c4-failure-excerpts.md`;
- auditoria de cobertura de capacidades: `docs/SECRETARY_AGENDA_CAPABILITY_MATRIX.md`.

Nenhum resultado histórico foi convertido em PASS.

### Projeção honesta

- **V3 (candidata 3):** 72,5% de pass^1 estrito.
- **Ganhos das correções, já deflacionados pelo revisor e sem dupla contagem:** ≈ +8,5 pp num conjunto no formato do V3.
- **Holdout novo e fresco:** ≈ 79–81% (faixa realista 75–84%), com 0 falhas de segurança.
- **90%:** exige a Candidata 5 (redução de instabilidade +4–5 pp, lacunas de capacidade +2–3, registros de áudio/saudação +2, lado da
  Luna +1–2).
- **95%:** meta de várias candidatas; provavelmente exige também melhora do lado do modelo.

Critério pré-registrado para a prova da Candidata 4:
- pass^1 estrito ≥ 80% no multi-salão v4, com 0 safety;
- pass^5, clarificação segura e falha funcional reportados;
- nenhuma dimensão de formato de data abaixo de 50% com n ≥ 5.

### Trilha R (produto), em ordem

1. **Datas:**
   - direção EXISTING para `cancel.date`/`change.source_date` (sem data passada como opção);
   - dia da semana filtrando o DATE_CHOICE;
   - canonicalização WEEKDAY+dia;
   - filtro LOCATE pelos agendamentos reais do cliente;
   - predicado negado sobre a data atual ("não pode no dia X") como restrição do localizador.
2. **Horas:**
   - meio período não escrito nunca é evidência;
   - guarda de saudação ("bom dia", "boa tarde");
   - aviso visível de "resposta não aplicada";
   - regra do tenant (seção 0), com os adversariais;
   - coerência de intervalo sem usar o padrão 8–11 como prova.
3. **Respostas sem loop:** pergunta fechada nunca se repete igual; as opções aparecem desde a primeira pergunta; `dateChoiceAnswer`.
4. **Alterar dados do agendamento (seção 0b + matriz C08–C11):**
   - trocar profissional, e trocar/adicionar/remover serviço, mantendo a data;
   - executor via `requestStaffReschedule`;
   - atrás de flag;
   - recusa quando a mudança exige aceite do cliente e ela não pode ser feita.
5. **Vários serviços num agendamento (C02):** `service_name` vira lista em `appointment.create`/`availability.get`, mesmo
   profissional, duração somada.
6. **Referências:**
   - dia compartilhado entre ações (same_as distributivo, com compactação do schema);
   - "no mesmo horário" do próprio agendamento, com guarda de genitivo;
   - "mesmo serviço";
   - "meu horário" (classe fechada de pronomes antes da busca);
   - horário liberado por **remarcação**, com precedência explícita da fila de espera (C21);
   - ordinal sobre uma leitura ("o último cliente dela"), ranqueando a leitura inteira.
7. **Leituras frequentes:**
   - próximo horário de um cliente sem data (C32);
   - agenda do salão inteiro, com o filtro aplicado antes do limite e resumo por profissional (C29);
   - disponibilidade sem profissional e aviso de "há mais horários" (C30/C31 a+b).
   - "Próximo horário livre" em vários dias fica para a Candidata 5.
8. **Guarda de recorrência (C03/X01):** "toda sexta" nunca vira uma ocorrência silenciosa; mostra UNSUPPORTED específico ou pergunta
   "marco só a primeira?".
9. **GF23:** decisão contraditória (encaixe + outro horário) nunca retira valor provado.
   **GF13:** a origem vem do agendamento escolhido, em todos os caminhos de seleção.
10. **Texto:**
    - perguntas por operação;
    - nome do cadastro nas mensagens;
    - cabeçalho de revisão verdadeiro;
    - erro interno com mensagem própria (nunca "Posso ajudar com...").
11. **Banco de exemplos:**
    - teste de contrato (todo exemplo decodifica estrito);
    - exemplos das estruturas novas com nomes diversos (seção 1).

### Trilha H (avaliação e operação)

- **M0 (medição):**
  - gerador v3, só a parte DEV: perfis noturno/24h/só manhã/almoço, estilo "hora solta", registros de áudio e saudação;
  - matriz de dias de execução;
  - métricas de nomes (seção 1);
  - diagnósticos só com códigos.
- **F1:** trava de estágio com espera limitada + lease por rodada + preflight de infraestrutura antes de consumir olhar.
- **F2:** "hoje" ancorado por tentativa; guarda de meia-noite pelo relógio; no máximo uma repetição.
- **F4:** identidade do banco local por bytes (hex) em todos os pontos de checagem.
- **F5:** gabarito T06 aceita "encaixe ou outro horário". **F6:** oráculo "A ou pergunta segura" como métrica secundária.
- **A4:** anotação `SAFETY_PROJECTION_ONLY` no relatório.
- Placar estrito congelado, sem conversão retroativa.

### Protocolo contra overfitting

- **Ajuste:** só testes unitários/adversariais, baterias DEV, uma bateria de regressão com as frases dos trechos (renomeadas) e o
  Golden.
- **Holdouts consumidos (V2, V3, dono v1, assistente v1, validação v1):** só regressão; retirados no registro.
- **Quem implementa a trilha R não lê `multi-salon/templates.ts`.** Antes da prova, o conjunto de frases e a semente do gerador são
  trocados, e o pool de nomes do holdout é disjunto de todos os corpora do repositório.
- **Pré-registro no freeze:** hash, versões de gabarito, tamanhos, k, regra do dia de execução e formato do relatório.
- **Relatórios obrigatórios:** gap DEV × holdout por dimensão; similaridade (≤ 1% das frases com Jaccard ≥ 0,6, nenhuma ≥ 0,8);
  concentração/overlap de nomes entregues ao dono antes da prova.

### Prova da Candidata 4 (um executor por vez, dia de execução pré-registrado, início ≥ 2× a estimativa antes da meia-noite de SP)

| Etapa | Tamanho | Custo aproximado |
|---|---|---|
| Golden 30 | k=5 | ~US$ 0,34 |
| Multi-salão v4 (novo) | 100 cenários × k=5 | ~US$ 1,00 |
| Holdout do dono v2 (frases novas escritas pelo dono) | ~60 frases, k=3 | ~US$ 0,35 |
| Holdout do assistente v2 (novo) | k=3 | ~US$ 0,15 |
| E2E com Playwright | — | ~US$ 0,05 |

- Total da prova ≈ US$ 1,9, mais ≈ US$ 0,4 de checagens DEV.
- Cabe no teto de US$ 6,00: gasto de US$ 3,25 até 29/09.
