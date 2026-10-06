# Crítica adversarial de segurança: Desenho A (ferramentas `consultar_agenda`) e Desenho B (contexto JIT `context_refs`)

Trabalhei só com leitura no worktree `D:/Projetos/barber-saas/.claude/worktrees/secretary-mobile-investigation-8658bb` (HEAD `c3d33de`). Não editei nem criei arquivos, não rodei git que altere nada, não acessei banco, rede ou Luna, e não abri nada em `secretary-holdout-sealed`. Os caminhos abaixo são relativos ao worktree. Cada achado indica se foi verificado no código ou se é plausível e não verificado.

Escala de severidade: CRÍTICA, ALTA, MÉDIA, BAIXA.

## 1. Riscos comuns aos dois desenhos

### C1 — CRÍTICA: auto-escolha silenciosa quando o conjunto admissível está incompleto

Os dois desenhos reutilizam `choiceVerdict`, feito para um cartão que o dono **viu**. Nos desenhos, o conjunto é oculto, então precisa estar completo. Hoje nada garante isso.

**Verificado no código:**
- `src/lib/secretary-options.ts:196`: `said` só guarda tokens que alguma opção tem. Um sobrenome que nenhuma opção tem é **ignorado**, não contradiz.
- `:220`: cartão de 1 opção sem restrição = `OK`.
- `:168`: "último" = tamanho do cartão.

**Fontes de truncamento:**
- `listSchedulingAppointments` usa `take:51` e não filtra status (`src/lib/scheduling-catalog.ts:183-197`; `dayWhere` em `:192` não tem `status`).
- `searchSalonCustomer` busca por substring com `LIMIT 21` (`src/lib/customer-catalog.ts:32-33`).
- `listUpcomingCustomerAppointments` usa `take` 3 por padrão (`scheduling-catalog.ts:229`).
- No Desenho B, o bloco é cortado por prioridade; no Desenho A, a saída pode vir `truncado`.

**Cenário:** o salão tem "Lívia Prado" e "Lívia Souza". O dono diz "remarca a Lívia Prado pra sexta às 15h". A linha de Lívia Prado ficou fora do conjunto (corte ou limite), então S = {Lívia Souza}. `said=[livia]` e "prado" é ignorado, o que dá `OK`, e o atendimento de Lívia Souza é movido. Variante: dia com 60 atendimentos, e "o último cliente da Débora" vira o 51º, ou um atendimento CANCELLED.

**Contenção:**
- S vem de uma consulta própria no tenant, feita na hora da validação, sem truncamento e com COUNT.
- Só PENDING/CONFIRMED, em ordem cronológica.
- Ordinal só dentro de um único dia e profissional provados.
- Se a contagem passa do limite, pergunta.
- Regra de subconjunto de tokens: todo token de nome do literal precisa estar na opção escolhida; token ausente = `OPTION_ECHO_MISMATCH`.
- Nunca montar S a partir das linhas renderizadas ou da saída da ferramenta.

### C2 — ALTA: um nome completo copiado da agenda escolhe sozinho no lote T21 (cancelar + criar)

**Verificado no código:**
- `src/lib/scheduling-batch.ts:120` faz `searchSalonCustomer(customer_name)`, e `:102` escolhe com `rows.length===1`.
- Não há prova de menção nesse caminho (grep por `nameInText|unproven|literalProofSpans` em `scheduling-batch.ts` e `secretary-batch.ts` não achou nada).
- Hoje a Luna não vê nomes de clientes (`packages/salon-secretary/src/conversation-routing.ts:16-18`). Ela escreve "Nara", a busca acha 2 linhas e sai cartão.
- Com A ou B, a Luna vê "Nara Uchoa" (desmascarado, porque "nara" está na mensagem) e copia o nome completo.

**Cenário:** "cancela a Iolanda de amanhã às 10h e põe a Nara no lugar", com "Nara Uchoa" e "Nara Prado" cadastradas. A busca por "Nara Uchoa" acha 1 linha e escolhe sem cartão.

**Também:** no adaptador simples, sem `NAME_SUGGESTIONS` o eco passa direto (`src/lib/secretary-scheduling.ts:824` faz `continue` e `:440` escolhe).

**Contenção:**
- Prova de menção (`nameInText`/`directorySubsetProof` sobre a cláusula) no caminho do lote, para cliente e profissional, antes da busca.
- As flags LOOKUPS e CONTEXT_ROWS só ligam com `NAME_SUGGESTIONS` ligada; senão, falham ao iniciar.

### C3 — ALTA: uma negação recusada volta a um caminho sem portão por operação

- **Desenho A:** V0 recusado "volta ao caminho da C4".
- **Desenho B:** V4 só tira a ref, e o campo normal segue.
- **Verificado no código:**
  - A negação hoje é tratada por valor: `temporalLiteralNegated` (`src/lib/scheduling-temporal-source.ts:139-152`); `governingNegators` só deixa o negador visível (`src/lib/secretary-sibling-scope.ts:245-252`).
  - Com uma ação só, a cláusula nem é recortada (`:214`).
  - O locate escolhe o único atendimento futuro da cliente (`secretary-scheduling.ts:546`).
- **Cenário (plausível, não testado):** "Não precisa cancelar a Bruna Teles; ela vem, o problema foi o trânsito". Por leitura errada ou por injeção, a Luna emite `appointment.cancel` com o motivo "o problema foi o trânsito" (literal, sem negador colado). A proposta de cancelamento sai pronta.
- **Contenção:**
  - Com a flag, criar um portão por operação: se o `source_scope` tem negador que governa o verbo, a operação vira pergunta, com ou sem `resolucao`/`context_refs`.
  - Duas operações mutantes com `source_scope` sobreposto (`secretary-sibling-scope.ts:234`): a segunda vira pergunta.
  - Testes de falso positivo: "não pera, cancela…" e "cancela a X, não a Y".

### C4 — ALTA: a menção à cliente vira âncora, contornando GF14 e a regra 1

- **Desenho B, V8:** "âncora em outra linha vale". O `row` aceita qualquer tipo em qualquer campo (`^[DPHAFSC]…`).
- **Desenho A, V10:** só exige conferência quando há ordinal.
- **Cenário:** "passa a Lívia Prado pra quinta" (só o dia). A Luna emite `context_refs {field:"time", row:"A9", edge:"START", literal:"a Lívia Prado"}`, onde A9 é outro atendimento dela na quinta às 10h. O literal existe, não é negado e é único, então 10h é semeado e a GF14 é pulada. Variante: `date` apontando para uma linha `A` preenche o dia de uma criação e pula a regra 1.
- **Contenção:**
  - Matriz campo ↔ tipo de ref no decoder:
    - `date` só vem de `D`, com o mesmo literal de origem;
    - `time`/`end_time` só de `A`/`F`;
    - `appointment` só de `A`;
    - `customer` só de `C`, `professional` só de `P`, `service` só de `S`.
  - Um trecho do texto prova um papel só.
  - A âncora exige um marcador relacional de classe fechada, separado da menção à entidade da própria ação.
  - A âncora nunca fornece o dia de uma criação, nem a hora de uma remarcação só de dia sem "mantém" provado.

### C5 — ALTA: exceção ou parte do pedido perdida com fim derivado

- **Cenário:** "fecha a agenda do Otávio amanhã das 17h às 20h, menos o horário da Camila Reis" (Camila das 18h às 19h). A Luna emite um bloqueio com início "17h" e fim = fim de F1 (18h) no B, ou início de Camila no A. A trava de bloqueio só olha o intervalo derivado (17h–18h), não acha atendimento dentro e não mostra o cartão da regra 10. O trecho das 19h às 20h some.
- **Contenção:**
  - A cobertura (`applyScopeCoverage`) vale também para valores derivados: o "20h" não consumido gera pergunta.
  - A trava de bloqueio avalia o intervalo literal do dono.
  - Quando a exceção divide o intervalo, mostrar o cartão da regra 10 (decisão de 30/09).
  - `COMBO_GUARD` e `BLOCK_OVERLAP_GUARD` ligadas nos dois braços (hoje vêm desligadas).

### C6 — MÉDIA/ALTA: a ref semeada pula as salvaguardas do locate (B1/B6)

- **Verificado no código:** `secretary-scheduling.ts:530-551`. Um dia passado ou uma origem negada viram cartão (`held`, `:544`) em vez de escolher a próxima ocorrência.
- **Cenário:** "a Rita Lobo faltou dia 25, remarca ela pra sexta às 9h". Um `appointment` semeado (B: "semear appointment"; A: gancho em ":545-551") escolhe a próxima ocorrência sem perguntar.
- **Contenção:** uma ref de atendimento só vale como escolha no ramo final de cartão (`rows>1`), depois de `held`, `hint`, `dropped`, alias, sugestão e combo. Ela precisa pertencer ao resultado do próprio locate.

### C7 — MÉDIA: valor derivado sobrevive quando a base muda (plausível, não verificado)

- **Cenário:** "põe a Nara depois do último cliente da Débora amanhã" dá 15h40. No turno seguinte, "na verdade quinta": o PATCH troca o dia e mantém 15h40, mas na quinta o último termina às 18h.
- **Contenção:** gravar a proveniência (`base`, dia, profissional, `anchor_ref`) no estado do filho. Um PATCH de qualquer base apaga o valor derivado (pergunta ou recalcula com releitura).

### C8 — MÉDIA: dado velho entre a proposta e o Confirmar

- **Verificado no código:** o snapshot só confere o slot (`src/lib/scheduling-actions.ts:51-70`, rechecado em `:239`). A semântica da âncora, do ordinal e da delegação não é reconferida.
- **Cenário:** a proposta diz "10h40, logo após a Lívia". Antes do Confirmar, Lívia cancela pelo app público, ou alguém marca às 17h e deixa de valer o "depois do último". A gravação acontece mesmo assim.
- **Contenção:**
  - Guardar `anchor_ref` + revisão (`xmin`), ordinal e o conjunto E na unidade do plano.
  - Reconferir em `confirmActionPlanGroup`/`confirmReadyGroups` (camada FREE, sem tocar no diário). Se mudou, `REVIEW_REQUIRED`.
  - A prévia cita a âncora.

### C9 — MÉDIA: "Confirmar tudo" amplifica uma proposta indevida

- **Verificado no código:** `src/app/(admin)/servicos/secretaria/secretary-chat.tsx:381-386` e `src/lib/salon-secretary.ts:1900`. Um clique confirma todos os grupos prontos.
- **Contenção (no piloto):** uma proposta com qualquer valor vindo de ref, âncora ou delegação mostra "escolhido pela agenda: …" e fica fora do "Confirmar tudo".

### C10 — MÉDIA: injeção pelo nome de cliente, que o público controla

- **Verificado no código:**
  - O cadastro público aceita `name: z.string().trim().min(2).max(120)` (`src/app/book/[salonSlug]/auth-actions.ts:50,283`); o nome de convidado da lista de espera também (`src/lib/waitlist.ts:596-599`).
  - `nameTokens` só descarta da/de/do/das/dos/e (`src/lib/name-search.ts:28-30`). Uma cliente cadastrada como "Amanhã Corte …" fica sempre desmascarada.
  - Os rótulos são strings unidas por " · " e depois quebradas de novo (`secretary-scheduling.ts:427`, `secretary-options.ts:159`). Um nome com " · 87" forja um "final de telefone".
- **O que a injeção consegue:**
  - acrescentar ou alterar operações usando literais do próprio dono (troca de papéis);
  - omitir uma operação;
  - disparar DISCARD/`rejected`, que retira propostas mas não grava nada.
- **Contenção:**
  - Os dados vão só como valores JSON numa lista branca de campos, sem observações ou motivos.
  - Nomes restritos a letras, dígitos, espaço, apóstrofo e hífen, sem separadores.
  - Desmascarar só pela regra de subconjunto C7, com a cliente ∈ S.
  - Testes adversariais com nomes injetados.
  - Métrica `ops_sem_clausula_do_dono`.

### C11 — MÉDIA: delegação sem marcador vira auto-escolha

- **Hoje:** só atribui sozinho quando existe um único profissional elegível (`secretary-scheduling.ts:469`, `scheduling-contract.ts:70`).
- **Desenhos:** no A, `DELEGADO` é um rótulo da Luna; no B, "sem token de nome" já conta como delegação.
- **Cenário:** "marca a Nara amanhã às 15h pra escova", com 3 elegíveis e 1 livre. A C4 mostra cartão; o desenho semeia o livre sozinho.
- **Contenção:**
  - Aceitar delegação só com marcador indefinido de classe fechada (quem/qualquer/alguém…) na cláusula; senão, trata como `NAO_DITO` e mostra cartão.
  - E é recalculado por disponibilidade completa, nunca pelas linhas F renderizadas.
  - Com |E| > 1, cartão.

### C12 — BAIXA: prova contra um diretório truncado

`secretaryDirectory` usa `take:40` (`scheduling-catalog.ts:49`), então `directorySubsetProof` (`name-search.ts:128-133`) pode achar um titular "único" numa lista truncada. O problema já existe hoje. Não verifiquei se `salonDirectoryNames` também é truncado.

### Isolamento entre salões

As leituras reutilizadas filtram `salonId`:
- `scheduling-catalog.ts:192`, `:218` e `:229`;
- `customer-catalog.ts:32-33`.

Não encontrei caminho de leitura cruzada. O risco que sobra fica na implementação: o binding não pode ir para um cache de módulo. Se o RLS está aplicado: não verificado.

## 2. Riscos específicos do Desenho A (ferramentas)

- **A1 — ALTA: afrouxa a trava de custo e contraria `AGENT_RULES.md:52` e `:24-27`.**
  - Hoje o guarda recusa item que não seja `message` (`packages/salon-secretary/src/openai-cost-guard.ts:53`), mais de 1 ferramenta (`:43`) e `tool_choice` que não seja objeto (`:44`).
  - **Contenção:** preferir a contingência A-env. Se o laço for adotado:
    - chaves exatas e um único par de itens de função;
    - o `call_id` é o da rodada 1;
    - o `output` é emitido só pelo serializador do backend, com identidade num WeakMap como `repairRequests` (`source-literal-repair.ts:8`);
    - aceite registrado do coordenador.
- **A2 — MÉDIA: não há prazo único por mensagem.**
  - Cada requisição tem 30 s (`packages/salon-secretary/src/index.ts:432`) e o Runner tem 45 s (`:321`). Com um `Runner.run` por rodada, rodada 1 + banco + rodada 2 + reparo pode passar de 45 s.
  - Um HORARIOS_LIVRES "por profissional elegível" × 3 consultas × 2 s por leitura explode num salão com 40 profissionais.
  - **Contenção:** um único `AbortSignal` de 45 s para a mensagem inteira; orçamento total de banco ≤ 3 s; no máximo N profissionais por consulta (senão, `truncado` + pergunta); falha ou timeout de consulta volta ao caminho da C4.
- **A3 — MÉDIA: a saída da ferramenta fica depois da mensagem do dono** (D5), a posição de maior efeito para injeção. A contenção é a de C10, mais o teste "a saída da ferramenta tenta criar uma operação".
- **A4 — MÉDIA: âncora sem ordinal escapa de V3/V4.**
  - **Cenário:** "põe a Nara logo depois da Lívia amanhã com a Débora", com Lívia Prado às 10h e Lívia Souza às 14h com a Débora. A Luna aponta a das 14h. V10 relê, confirma que está ativa, no mesmo dia e com a mesma profissional, e aceita. É auto-escolha entre homônimas.
  - **Contenção:** `ancora.ref` sempre passa por V3 e V4.
- **A5 — BAIXA: a janela de S pode vir da Luna.** S tem de usar a janela do backend (de agora em diante, pelo locate), nunca `a_partir_de` ou `data` da consulta da Luna.
- **A6 — BAIXA: reparo.** O registro de testemunhas não inclui `resolucao` (`source-literal-repair.ts:20-29`); isso é bom. Falta um teste mostrando que o reparo da rodada 2 não altera refs e conta como a 3ª chamada.
- **A7 — BAIXA: custo.** Fica limitado a 3 chamadas, e a injeção não aumenta esse número. Risco de consultar em toda mensagem com `tool_choice:"required"`: medir a taxa de consulta nos pedidos simples e na Golden.

## 3. Riscos específicos do Desenho B (contexto JIT)

- **B1 — ALTA: `s.contextBinding` fica na Session.**
  - **Verificado no código:** `conversationRecord` só remove `actor`/`busy`/`optionBinding` (`src/lib/salon-secretary.ts:231`). Qualquer campo novo da Session é gravado. A leitura estrita no carregamento falha fechada e **remove a conversa** (`:193-200`).
  - Consequência: perda do plano ativo, e ids ou nomes gravados no estado.
  - **Contenção:** o binding fica só em ALS, ou entra em `strip`, com teste de que o estado gravado nunca o contém.
- **B2 — ALTA: prescan por token com `LIKE %token%`** (`customer-catalog.ts:32-33`).
  - Tokens como "corte", "amanhã" ou "ana" puxam "Mariana" e parecidos, já desmascarados. O resultado é vazamento para a OpenAI, superfície de injeção e conjuntos S sujos.
  - **Contenção:** igualdade exata de token de nome; excluir os trechos já lidos como tempo (pelo extrator existente, de forma estrutural); teto de linhas.
- **B3 — MÉDIA: `edge` START/END não tem como ser verificado.**
  - **Cenário:** "encaixa a Nara com o Otávio antes da Lívia" dá END, e a Nara fica às 10h40.
  - **Contenção:** conferir a polaridade de um marcador relacional de classe fechada (antes/até/quando chegar → START; depois/após/quando sair/terminar → END). Divergente ou ausente: pergunta.
- **B4 — MÉDIA: ids posicionais.** O binding precisa ser exatamente o conjunto de linhas renderizadas. Um id válido pelo padrão mas cortado (ex.: "A7") dá `CONTEXT_REF_UNKNOWN`.
- **B5 — MÉDIA: o conjunto admissível vem das linhas do instante T0.** Precisa ser recalculado com releitura na validação.
- **B6 — BAIXA: o prescan roda em toda mensagem**, inclusive "oi": custo de banco por mensagem.

## 4. Comparação

Os riscos C1–C11 dominam e valem para os dois desenhos. O Desenho B mantém `MODEL_CALL_LIMIT` e a trava de custo, então mexe menos em contratos. Por outro lado, expõe mais dados por mensagem e tem o problema de persistência B1. O Desenho A afrouxa a trava de custo e põe os dados na posição mais sensível a injeção. Nenhum dos dois, como está escrito, cumpre "0 escrita errada" sem as contenções abaixo.

## 5. Contenções obrigatórias, qualquer que seja o desenho adotado

1. **Dependências de flag que falham fechadas:** LOOKUPS ou CONTEXT_ROWS exigem `NAME_SUGGESTIONS`, `COMBO_GUARD`, `BLOCK_OVERLAP_GUARD`, `DATE_RULES_V2` e `REFERENCES_V2`, com teste de contrato. Com as flags desligadas, wire e comportamento ficam idênticos byte a byte.
2. **Conjunto S independente:** consulta no tenant, na hora da validação, sem truncamento e com COUNT; só PENDING/CONFIRMED, em ordem cronológica; ordinal num único dia e profissional. Se a contagem passa do limite, pergunta. Nunca a partir das linhas mostradas à Luna.
3. **Verificação mais rígida que `choiceVerdict`:** todo token de nome do literal precisa estar na opção; pronome sozinho nunca prova; |S|=1 só vale quando S foi montado pelos tokens do próprio literal.
4. **Matriz campo ↔ tipo de ref**, um papel por trecho do texto e marcador relacional para âncoras. Âncora nunca fornece o dia (regra 1) nem a hora de uma remarcação só de dia (GF14) sem "mantém" provado.
5. **Portão de negação por operação**, independente da resolução. Operações mutantes com `source_scope` sobreposto viram pergunta.
6. **Prova de menção no lote T21**, para cliente e profissional.
7. **Ref aceita só no ramo de cartão**, depois de todas as salvaguardas do locate e dos cartões de sugestão, alias e combo.
8. **Cobertura temporal sobre valores derivados**, trava de bloqueio sobre o intervalo literal do dono e cartão da regra 10 quando a exceção divide o intervalo.
9. **Delegação só com marcador**, E recalculado por inteiro e |E| > 1 vira cartão.
10. **Proveniência dos valores derivados:** PATCH de uma base invalida o valor; reconferência antes do Confirmar (camada FREE, `REVIEW_REQUIRED`); a prévia nomeia a âncora; no piloto, essas propostas ficam fora do "Confirmar tudo".
11. **Binding só em ALS, válido só na mensagem;** teste de que o estado gravado nunca o contém.
12. **Renderização:** só JSON, lista branca de campos, nomes saneados sem separadores, máscara pela regra C7; rótulos estruturados no código novo.
13. **Prazo único de 45 s por mensagem**, orçamento de banco e volta ao caminho da C4 em qualquer falha do executor. Aumentar os timeouts continua sendo uma decisão separada.
14. **Telemetria só com códigos e contagens:** refs aceitas ou recusadas por código, valores derivados, `ops_sem_clausula_do_dono`, escritas com valor derivado.
15. **Medição antes de pagar:** um conjunto adversarial sintético offline, com modelo falso, cobrindo homônimos, nomes injetados, negações, exceções, remarcação só de dia, T21 com homônimos e âncora velha. Veto em qualquer escrita errada; Golden 150/150; replays com as flags desligadas idênticos.

## 6. Não verificado

- Se um PATCH mantém a hora semeada depois de trocar o dia (C7).
- O cenário de C3 com motivo literal (plausível, não testado).
- Se `salonDirectoryNames` é truncado.
- Se o RLS está aplicado.
- A folga real do orçamento de bytes nos turnos de plano com os dois desenhos.
- Se a API aceita `function_call` sem `id`/`reasoning` com `store:false` (Desenho A).
- Se o ajuste de tokens do mapa de wire vale para o maior turno. Ao converter 16.390 tokens em bytes (≈57,3 KB + 8.192), chego perto ou acima do teto de 64.000, o que não bate com "nenhuma degradação".
