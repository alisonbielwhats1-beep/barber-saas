# Auditoria Luna × pipeline da Secretária V1

26/09/2026 · somente auditoria e proposta. Nenhuma inferência nova, chamada de
STT, mutation, alteração de runtime, build, deploy ou acesso a Production nesta
etapa. As correções locais anteriores não foram revertidas nem promovidas.
Staging permanece no último estado OFF comprovado; não foi religado para auditar.

## Resumo executivo — 15 pontos

1. Luna acerta casos relevantes, mas esta amostra não mede sua qualidade geral.
2. Há outputs semânticos errados em **2 episódios**: G e continuação Amanda; esta recebeu contexto incompleto.
3. **2/7 episódios recentes** têm causa primária pós-Luna: falso positivo temporal e continuidade de estado.
4. Sim, existe interpretação duplicada: o guard reextrai horários sem conservar os papéis atribuídos.
5. Origem/destino existem no schema, mas o validador e a projeção do plano não respeitam integralmente essa separação.
6. A identidade do draft continua; seus valores e o contexto da pergunta não continuam corretamente no caso Amanda.
7. **2/7 episódios** vieram do harness, e a instrumentação corrigida ainda possui acoplamento ao caminho crítico.
8. UNSUPPORTED não tem contrato de resposta suficiente: mistura-se com ambiguidade e gera card de preparação.
9. A causa principal da cadeia Amanda é perda de papéis/estado e ausência do alvo da clarificação no contexto enviado.
10. Sim, simplificar as fronteiras entre interpretação, estado validado e apresentação; não reescrever o domínio.
11. Preservar temporal factual, identidade, RLS, permissões, HARD_BLOCK, confirmação, idempotência e EXACT.
12. Mínimo recomendado: contexto explícito de clarificação + estado efetivo único + grounding por campo/papel.
13. Risco médio/alto: sincronização incorreta pode ressuscitar dados rejeitados ou aprovações antigas.
14. Exigir replay offline dos outputs preservados, invariantes por família e depois as 30 conversas inéditas preparadas.
15. Parar aqui para decisão sobre o plano; não promover o patch restrito anterior como solução estrutural.

## 1. Escopo, proveniência e limites

Foram inspecionados código atual, respostas brutas capturadas do provider manual,
respostas reais das Server Actions, resultados/journals históricos e relatórios
causais BEFORE/AFTER. Os prints do usuário orientam a seleção, mas não substituem
o journal. Não se fez inferência para preencher evidência ausente.

O build efetivamente usado na conversa Amanda foi `X_pW4ibxpeH-NHIM1dIDS`.
O checkout contém a correção local posterior, não publicada, descrita em
[SOURCE_TIME_FIX](./SECRETARY_MANUAL_SOURCE_TIME_FIX.md). As conclusões sobre o
incidente usam o output histórico; a inspeção do código identifica os mecanismos
e distingue o pequeno patch já presente. Não se confunde fonte atual com release.

[Evidência compacta com hashes](./SECRETARY_LUNA_PIPELINE_AUDIT_EVIDENCE.json)
preserva quatro turnos Amanda, argumentos brutos, estados efetivos, dez turnos
x41/x42/x44/x46/x49 e nove turnos x90–x93. Os caminhos e hashes permitem rastrear
os artefatos originais sem copiar snapshots de banco com dados de autenticação.

Limites importantes:

- O snapshot manual importado contém 14 respostas de request, sete outputs do
  modelo e 14 registros de orçamento: sete STARTED, seis SUCCEEDED e um UNKNOWN.
  É um recorte diagnóstico, **não o journal final de custo**. Não recalcula saldo.
- Nos resultados históricos x41–x49 e x90–x93, o objeto observado é plano/draft
  posterior ao adapter, com testemunho HTTP/schema. Não é uma cópia universal do
  JSON bruto. A coluna “Luna bruto” declara essa ausência em vez de reconstruí-lo.
- x44 original não preservou os valores das chaves inválidas; `A` foi apenas um
  exemplo sintético da reprodução histórica, nunca o valor real alegado.
- G tem transcript, `model_weekday=6`, proposal/UI e diagnóstico duráveis; o
  arquivo `G-final-original-response.json` é a resposta do backend, não deve ser
  vendido como se fosse a resposta bruta inteira do provider.
- O código permite determinar como se monta o contexto de continuação, mas o
  request completo enviado ao provider nesse turno não foi retido no recorte.
  Essa conclusão é inspeção de código, não captura do prompt na rede.
- Os marcos históricos permanecem; eles comprovam seus recortes, não cobertura
  universal de linguagem natural nem aprovação da experiência manual atual.

## 2. Onde a informação correta se perde — Amanda

**Mensagem real, 14:34:31Z:** “altere a amanda souza das 11h para amanha as 09h”.

Argumentos de `select_capabilities`, antes dos guards:

```json
{
  "operation": "appointment.change",
  "customer_name": "Amanda Souza",
  "source_time": "11:00",
  "day_offset": 1,
  "time": "09:00"
}
```

Luna distinguiu corretamente origem e destino. O esquema atual também os
representa separadamente: `source_*` localiza a reserva; `date/time` é destino
em `appointment.change`. A data original pode faltar legitimamente quando o
backend consegue resolver uma reserva única com os seletores fornecidos.

O percurso observado foi:

| Fronteira | Informação observada |
|---|---|
| Provider bruto | `source_time=11:00`, `day_offset=1`, `time=09:00` |
| Criação do ActionPlan | Recebe a seleção estruturada; não há captura independente deste instante |
| Guard temporal histórico | Reextrai dois clocks; condição de múltiplos valores/campos ativos recusa ambos sem distinguir os papéis |
| Draft efetivo, revisão 1 | `{customer_name: Amanda Souza, date: 2026-09-27}`; **sem origem e sem destino horário** |
| Pendências persistidas | `temporal_missing=[time,source_time]`; missing inclui `appointment_ref` |
| Plano devolvido, revisão 2 | Ainda contém `time=09:00` e `source_time=11:00`, apesar de marcá-los missing |
| Resposta composta | “Qual agendamento você deseja alterar?”; não expõe que o adapter acabou de rejeitar os dois horários |

**Classificação primária: GROUNDING_FALSE_POSITIVE.** Efeito posterior comprovado:
POST_LUNA_INFORMATION_LOSS no draft. Não havia ambiguidade entre 11h e 09h na
frase. Uma eventual inexistência da reserva seria outra decisão do domínio.

A divergência plano/draft é explicada por `collectedActionFields`:
`{...action.fields, ...camposPresentesDoDraft}`. Campo removido do draft não apaga
o valor antigo no plano. Há tratamento explícito para limpar consentimento/motivo,
mas não a mesma semântica de remoção para todos os temporais rejeitados.
Assim, `action.fields` parece ter valor aceito enquanto `missing_fields` o nega.
Isso não tornou a confirmação executável nesse episódio, mas fornece contexto
inconsistente para UI e outros caminhos de continuação.

### Continuação real

Mesma conversation, mesmo plan e mesmo draft durante todos os turnos.

| Mensagem | Luna bruto (`upsert_action_draft`) | Draft efetivo depois | Resposta |
|---|---|---|---|
| “o primeiro das 11h” | `time=11:00`, `source_time=null`, data 27/09 | destino passa a 11h; origem segue ausente; `temporal_missing=[source_time]` | “Pode informar horário original?” |
| “11h” | `time=11:00`, `source_time=null` | mesmo destino 11h; `waiting_for=source_time` | mesma pergunta |
| “11h” | `time=11:00`, `source_time=null`, data 27/09 | mesma situação; revisão aumenta | mesma pergunta |

Respostas diretas às perguntas da auditoria:

- O draft **não** tinha mais destino 09h quando recebeu “11h”; já o perdera no
  primeiro turno. O plano de apresentação ainda o exibia antes da continuação.
- Após “o primeiro”, o campo realmente pendente era `source_time`; o destino
  efetivo estava erroneamente em 11h.
- Luna **não** preencheu `source_time=11h` nos três outputs capturados. Preencheu
  `time=11h`. Não houve rejeição de um `source_time` correto nessas respostas.
- O fast path antigo reconhecia apenas `time/end_time`, não `source_time`.
- `sendSchedulingTurn` enviava operação, campos atuais sem refs e requisitos
  estáticos. Não enviava `waiting_for`, `temporal_missing`, missing efetivo ou a
  pergunta anterior. O modelo não recebia a instrução contextual de que “11h”
  respondia ao horário **original**. A Skill contém a distinção de papéis, mas
  essa instrução geral não supre o estado conversacional ausente.
- A camada de persistência conserva `temporal_missing` enquanto o campo está
  ausente. Como cada output preencheu o outro campo, a pendência não desapareceu.
- O adapter não tinha label de `source_time`, gerando “Informe .”. O compositor
  tinha esse label e gerava a pergunta inteligível. São duas representações da
  mesma pendência que divergiam.

**Classificação primária da cadeia de continuação: DRAFT_STATE_BUG**, abrangendo
estado/contexto conversacional. Existem três outputs semanticamente errados do
Luna dentro dela; não se pode atribuir causalmente esse episódio só ao modelo,
pois o aplicativo retirou o destino e omitiu o alvo da pergunta. Não é prova de
que um prompt com contexto correto resolveria tudo: isso ainda exigiria teste.

O draft chegou a conter `appointment_ref` depois da busca sem `source_time`.
Sem resolver essa referência contra a snapshot específica, esta auditoria não
afirma qual appointment foi selecionado, nem transforma a ausência de mutation
em prova de seleção correta. Há risco de busca ampla após remover seletor; uma
correção deve impedir proposta enquanto a restrição original estiver pendente.

**Relógio:** a conversa ocorreu às 11:34 BRT de 26/09. A busca atual exclui
agendamentos já iniciados. Se a origem era o atendimento daquele dia às 11h,
o resultado correto seria indisponibilidade/inexistência de reserva futura,
sem selecionar outro atendimento. Esse fato não justifica apagar os dois horários
nem repetir a pergunta. A expectativa semântica e a elegibilidade são gates distintos.

## 3. Matriz Luna versus pipeline

Cada linha tem uma causa primária do vocabulário solicitado. Efeitos associados
estão descritos, sem somá-los como episódios independentes. “Indisponível” na
coluna bruto significa lacuna de evidência, não inferência errada.

| Caso | Mensagem | Luna bruto | ActionPlan inicial | Alteração posterior | Resultado | Causa |
|---|---|---|---|---|---|---|
| R1 conexão | abertura/Nova conversa antes das falas | Não chamado | Não criado | Observador inicia fluxo do body antes do parser Next | HTTP 500; JSON vazio; corrigido historicamente | HARNESS_INTERFERENCE |
| R2 conflito manual | “pode marcar mesmo com conflito” | Sem transporte nessa tentativa | Plano anterior em conflito | Observer exige schema discovery em `upsert_action_draft` | Falha segura, antes de Luna; reteste funcional pendente | HARNESS_INTERFERENCE |
| R3 profissional | “adicione um novo profissional ao meu estabelecimento” | `skills=[],operations=[]` | Nenhum | Fallback mistura unsupported/ambiguidade; UI cria card genérico | “Vamos preparar sua ação”, sem capacidade real | UNSUPPORTED_CAPABILITY |
| R4 Amanda inicial | “das 11h para amanhã às 09h” | Origem 11h, destino 09h, offset 1 | Seleção correta; plano devolvido ainda conserva valores | Guard remove os dois clocks do draft | Pergunta indevida; não confirmável | GROUNDING_FALSE_POSITIVE |
| R5 Amanda continuação | “o primeiro das 11h”; “11h”; “11h” | Nos três: destino 11h, origem null | Mesmo plano, com campos e missing divergentes | Contexto não informa pergunta pendente; merge muda destino; origem segue faltante | Loop + “Informe .”, mesmo draft | DRAFT_STATE_BUG |
| R6 G original | “domingo às dez horas” | `weekday=6` registrado no diagnóstico | Interpretação errada aceita | Domínio calcula sábado 03/10 sem confronto com domingo | Proposal errada confirmável; nenhuma confirmação | LUNA_SEMANTIC_ERROR |
| R7 D inicial | “Altera a Massagem para oitenta reais” | Provider SUCCEEDED; bruto causal não retido | Não alcança draft/skills no diagnóstico | Exceção causal não preservada | BACKEND_FAILURE; repetição posterior não apaga falha | UNKNOWN |
| H41 | “Marca um Corte Completo pro Andrinho amanhã” → “10h” | Indisponível; plano conserva os dados | 1 ação, falta hora | Adapter + rodapé repetem pergunta e expõem campo técnico | Sem perda operacional demonstrada; UX falhou | PRESENTATION_BUG |
| H42 UX | “Marca um corte pro Andrinho amanhã” → “10h” | Indisponível; plano conserva consulta “corte” | 1 ação; três serviços candidatos | Pergunta profissional cedo e duplica serviço/selection | UX falhou; ambiguidade real permanece | PRESENTATION_BUG |
| H42 escolha | mesma conversa, serviço “corte” | Não há prova de escolha errada do modelo | Três candidatos reais, nenhum escolhido | Backend mantém seleção após hora informada | NEEDS_INPUT legítimo | TRUE_AMBIGUITY |
| H44 UX | agenda Andrinho + bloqueia Tatiana 14h–15h | Indisponível; plano observado tem 2 ações | Agendar incompleto; bloqueio completo | Rodapé pergunta profissional antes de serviço | UX falhou; duas ações preservadas | PRESENTATION_BUG |
| H46 UX | cancelar/substituir/avisar/preço/financeiro | Indisponível; plano observado tem 5 ações | Só serviço do create ausente | Preview do grupo e rodapé repetem a pergunta | UX falhou; DAG preservado | PRESENTATION_BUG |
| H49 UX | dez ações, falta serviço e fim do bloqueio | Indisponível; plano observado tem 10 ações | Duas pendências | Perguntas repetidas e campos técnicos | UX falhou; plano não perdeu as oito completas | PRESENTATION_BUG |
| H44 contrato | primeira tentativa da microbateria real | `invalid_format` em duas item_key; valores não retidos | Não preparado | Schema publicado omitia pattern que validator local exigia | CONTRACT_MISMATCH, rejeição segura | POST_LUNA_REINTERPRETATION |
| H-TZ | previews de x41/x44/x46 | Sem erro de timezone demonstrado no modelo | Domínio usa America/Sao_Paulo | Sanitizador considera Sao_Paulo um identificador técnico | America/informação que falta; corrigido depois | PRESENTATION_BUG |
| H90 | cancela Amanda e coloca Fábio/Corte Completo | Bruto não retido; motivo efetivo “a pedido dela” | 2 ações e proposta coerentes | Evaluator exige “pedido dela” literalmente | Falso negativo histórico; reavaliação PASS | HARNESS_INTERFERENCE |
| H91 | cinco ações → serviço → encaixe → motivo | Bruto não retido; 4 turnos observados | Mesmo plano e DAG | Evaluator marca FIELD_LOST pelo mesmo motivo textual | Reavaliação PASS; perguntas de domínio legítimas | HARNESS_INTERFERENCE |
| H92 | substituição → “Outro horário” → “11h” | Bruto não retido; destino alternativo preservado | Mesmo plano e dependência | Evaluator textual dá falso negativo | Reavaliação PASS; vagas vêm do backend | HARNESS_INTERFERENCE |
| H93 | encaixe com motivo inicial | Diagnóstico registra “Ele já está aguardando” | Proposta com aviso e motivo presentes | Evaluator não reconhece equivalência autorizada | Alerta histórico de safety no scorer; reavaliação PASS | HARNESS_INTERFERENCE |
| H94 original | “porque ele já está aguardando” | Diagnóstico registra “Fábio já está aguardando” | Duas ações e aresta preservadas | Guard exige motivo ancorado; não há prova de correferência | Rejeita antes do HARD_BLOCK; sem draft | GROUNDING_CORRECT_REJECTION |
| H94 depois | mesmo pedido congelado, revalidação histórica | “Ele já está aguardando” | Duas ações, mesmo contrato | Motivo original preservado; disponibilidade avaliada | SALON_CLOSED; sem proposal; alternativas backend | BACKEND_DOMAIN_REJECTION |
| V-C original | complemento com “Tatiana A.” | Extração preserva pontuação no nome | Criação incompleta | Consulta não normaliza pontuação terminal | Não resolve profissional; correção histórica revalidada | POST_LUNA_REINTERPRETATION |
| V-G schema anterior | pedido de domingo, antes de publicar limites | `weekday=7` registrado | Não aceito | Schema de transporte omitia limite 0–6 exigido localmente | Rejeição segura; não confundir com posterior weekday=6 | POST_LUNA_REINTERPRETATION |
| V-E/E2 | cancela/coloca/avisa → “Corte Completo” | E1: três operações; E2 apenas STT | Não conclui preparação/continuação | COMMUNICATION_LOCAL_ONLY rejeita esse ambiente | Limitação de contrato; não falha semântica demonstrada | BACKEND_DOMAIN_REJECTION |
| G depois | mesmo áudio de domingo | `weekday=0,time=10:00` | Data 27/09 | Backend identifica fechamento | HARD_BLOCK, botão desabilitado | BACKEND_DOMAIN_REJECTION |
| Stale histórico | corrigir R$80 para R$90 e tentar approval antigo | Preço novo interpretado | Revisão muda | Fingerprint/revisão invalida proposal velha | CONFIRMATION_STALE; comportamento correto | GROUNDING_CORRECT_REJECTION |

H44 contrato usa POST_LUNA_REINTERPRETATION para representar exigência de contrato
posterior diferente do publicado, não uma reescrita dos bytes da resposta.
H90–H93 usam HARNESS_INTERFERENCE **no resultado do avaliador**, não interferência
nas requisições do produto. Stale usa GROUNDING_CORRECT_REJECTION no sentido de
guard factual de estado; não é um parser temporal.

Controles positivos consultados separadamente: voz A leitura; B faltantes; C
continuidade após normalização; F conflito real; H números 80/2/10:30; I negação;
J correção/stale/replay e reversão. Não entram na contagem de defeitos. As provas
de áudio sintético não equivalem a STT físico nem universalidade de sotaques.

## 4. Números, sem extrapolação

**Amostra recente definida: R1–R7, sete episódios causais**, não sete mensagens.
R4 e R5 são fases distintas da mesma conversa. As duas respostas “11h” não viram
dois defeitos independentes. Os históricos H/V não são somados a esse denominador.

| Causa primária exclusiva | Episódios |
|---|---:|
| Luna: erro semântico inicial inequívoco (G) | 1 |
| Pós-Luna: guard falso positivo + estado/contexto de continuação | 2 |
| Harness funcional: body consumido + asserção indevida | 2 |
| Capability não suportada | 1 |
| UNKNOWN | 1 |
| Total | 7 |

**Dimensões sobrepostas**, que não devem ser somadas ao total:

- Outputs do Luna semanticamente errados: **4 outputs em 2 episódios** — um G,
  três na continuação Amanda. Logo, “só um erro do Luna” seria incompleto; “quatro
  incidentes independentes do Luna” também seria incorreto.
- Falha de apresentação: **2 episódios recentes**, profissional e Amanda.
  O primeiro tem capability ausente e card errado; o segundo tem label vazio e
  pergunta incoerente com a informação inicial. UI exclusivamente primária: zero
  na distribuição acima, por escolha explícita da causa primária.
- Unsupported: **1 episódio recente**; ambiguidades reais demonstradas: **0/7**.
  “corte” em x42 é **1 caso histórico** de ambiguidade real, separado da amostra.
- A fronteira backend também contribuiu para G: faltava rejeitar contradição
  explícita. A causa primária Luna não exonera a falha de defesa já corrigida.

Históricos adicionais: cinco casos x41/x42/x44/x46/x49 com defeito de apresentação;
um incidente de schema item_key; um defeito de sanitização de timezone aparecendo
em três casos; quatro conversas x90–x93/nove turnos com falsos negativos do
evaluator; x94 original com rejeição fundamentada por falta de provenance.
Isso não fornece uma taxa de acerto global nem comparação entre modelos.

## 5. Arquitetura real e duplicações

O fluxo não é perfeitamente linear: validação de JSON/schema ocorre **antes** de
criar o ActionPlan; domínio, draft e assessment interagem e voltam a sincronizar
o plano. Há caminhos V1/legado, V2, single, batch e continuation múltipla.

| Camada | Responsabilidade observada | Diagnóstico |
|---|---|---|
| Registry/SDK | Catálogo fechado, function tool, JSON/schema, null omitido | Correto limitar autoridade; transportar constraints diferentes foi defeito histórico |
| Luna discovery | Linguagem → operação/campos/dependências | Acertou a separação Amanda; também produziu G errado |
| ActionPlan | Chaves/DAG, intenção, grupos e avaliação | Não é estado efetivo único; conserva valores rejeitados pelo filho |
| Grounding de fonte | Reextrai datas, clocks, negação; testa valores | Safety necessária, mas contagem global ignora papéis e cria falso positivo |
| Reconciliador temporal | Resolve incompatibilidades período/hora/fim | Validação de domínio legítima; chamado em aplicação e persistência, com risco de invalidações diferentes |
| Draft | Merge versionado, missing persistente, snapshot/proposal | Identidade/revisão fortes; contexto incompleto e ausência confundida com valor omitido em outras projeções |
| Domain assessment | Catálogo, horário futuro, duração, disponibilidade, permission | Autoridade correta; não transferir ao modelo |
| Composição/Front | Perguntas, cards, estado de confirmation | Dois níveis de mensagens; falta estado tipado fora do catálogo e seleção de pergunta não chega ao intérprete |
| Harness | Captura HTTP/provider, orçamento, scorer | Observabilidade, controle de admissão e assertions misturados |

**Source/destination não precisam ser inventados do zero.** Existem
`appointment_ref`, `source_date/source_day_offset/source_weekday/source_time` e
`date/day_offset/weekday/time`. São campos planos, com semântica dependente da
operação: em cancelamento `date/time` localizam origem; em bloqueio representam
início. Isso é uma fonte de complexidade, mas a falha Amanda não prova necessidade
de migration ou de grande schema aninhado. Prova que os papéis existentes não
são respeitados por todas as camadas.

**A menor fronteira faltante é a de clarificação.** Single scheduling não informa
pergunta/missing ao modelo; `continueMultipleActions` já informa ações elegíveis,
campos e missing. O compositor decide o que perguntar, sem devolver esse alvo
como contexto estruturado ao próximo turno. O guard e o modelo precisam então
adivinhar a função de uma resposta curta.

## 6. Classificação dos guards e invariantes

| Mecanismo | Classe | Decisão recomendada |
|---|---|---|
| Tenant, propriedade, papel, RLS/FORCE, autenticação | FACTUAL_SAFETY_GUARD | Preservar integralmente |
| Existência/seleção de entidade, appointment futuro | FACTUAL_SAFETY_GUARD | Preservar; não ampliar busca após rejeitar seletor explícito |
| Timezone, domingo versus sábado, limites de horário/data | FACTUAL_SAFETY_GUARD | Preservar confronto factual; mudar a atribuição global que mistura papéis |
| Regra “há dois clocks/campos, logo ambíguo” | SEMANTIC_DUPLICATION | Substituir por verificação por papel; não retirar rejeição de contradições |
| Contextual fast path de um campo pendente | LEGACY_COMPATIBILITY | Pode ser codec estrito com alvo explícito; nunca parser geral paralelo |
| Duração, recursos, conflito, jornada, HARD_BLOCK, override | FACTUAL_SAFETY_GUARD | Preservar domínio e permissões atuais |
| Motivo, consentimento, EXACT, source spans | FACTUAL_SAFETY_GUARD | Preservar prova; simplificar extração sem aceitar paráfrase/pronome sem binding |
| Regex de frases de motivo/consentimento | SEMANTIC_DUPLICATION | Avaliar limite e proveniência; não apagar junto com o guard factual |
| Campos/datas repetidos em plano legado, batch, draft | LEGACY_COMPATIBILITY | Projetar estado efetivo com invalidação explícita; manter adapters/transações |
| Revision/hash/expiração/idempotência | FACTUAL_SAFETY_GUARD | Preservar; aprovação antiga nunca ressuscita |
| Observer HTTP, dump do provider, scorer e assertions de wire | HARNESS_ONLY | Tirar assertions e falhas de escrita do caminho funcional |
| Limite de custo/allowlist/flags de staging | FACTUAL_SAFETY_GUARD | É admissão ativa, não observador passivo; manter fail-closed e journal |

Invariantes exigidos para a futura correção:

1. Output bruto é imutável; interpretação proposta e valor efetivo são estados
   distinguíveis, com motivo explícito de rejeição/invalidação.
2. Campo aceito no draft e campo efetivo apresentado no plano não divergem. Valor
   rejeitado permanece só em histórico, não reaparece via merge de ausência.
3. Resposta a `source_time` conserva destino 09h já validado. Uma correção explícita
   de destino pode alterá-lo; a mera resposta curta não pode.
4. O intérprete recebe ação alvo, campos aceitos, missing efetivo e pergunta
   pendente. Não recebe segredos/IDs que não precisa nem listas de clientes.
5. Missing é requisito de domínio + pendência factual + seleção real. Campo
   fornecido e validado deixa de ser missing; dados não fornecidos não são inventados.
6. Mudança material invalida proposal, approval e dependentes afetados. Mantém
   conversation/plan/draft quando o contrato permitir; preserva ações independentes.
7. Guard associa cada restrição ao papel correto, preserva negação e rejeita
   contradições, inclusive troca de origem/destino. Valor pertencer ao texto não
   basta para provar o papel. Sem atribuição comprovável, pergunta dirigida.
8. Unsupported não cria ação, draft, card de preparação ou confirmação.
9. Rejeição de domínio explica o motivo e oferece apenas alternativas backend.
10. Falha de observação não altera bytes, sessão, resultado ou controle de custo.

**Preço/quantidade:** H prova 80/2/10:30 na amostra; não foi encontrado nesta
inspeção um guard universal de fonte para todos os valores monetários. Validators
de intervalo e proposal visual não provam sozinhos “80 nunca vira 18”. Manter os
checks existentes e incluir contrastes na evidência exigida, sem alegar uma
garantia universal que os resultados não fornecem.

## 7. Harness: interferências comprovadas e risco residual

1. `request.on('data')` antes do handler Next consumia o body: falha reproduzida
   e corrigida historicamente. É interferência funcional comprovada.
2. Asserção de `select_capabilities` em toda chamada bloqueava `upsert_action_draft`
   antes do transporte. É interferência funcional comprovada, não Luna errando.
3. Evaluator de motivos/timezone/preview produziu diagnósticos falsos em x90–x93;
   não alterou o resultado operacional. Essa distinção deve ficar nos relatórios.
4. O observer corrigido ainda aguarda `response.clone().json()` e grava arquivo
   sincronicamente antes de devolver response; erro de parse/IO pode escapar.
   O budget wrapper também aguarda clone e faz append no caminho crítico.
5. O observer HTTP ainda intercepta emit/write/end, copia buffers e descomprime
   sincronicamente no finish; o callback `record` do catch pode lançar novamente.
   Isso cria risco residual e custo de CPU/event loop. **Não foi demonstrado novo
   incidente por esse risco**, nem quantificada sua latência. Não chamar de passivo
   apenas porque três testes de body/gzip passaram.

Separar admissão/custo (bloqueio deliberado, antes da chamada, deve permanecer)
de observação (captura limitada, falha isolada, não interfere no resultado).
Assertions de schema pertencem ao preflight/teste de contrato, não a um observer
de todas as chamadas manuais. Não remover o limite de custo para obter passividade.

## 8. Menor plano de simplificação — proposta, não implementada

| Mudança | Código/camada atual | Responsabilidade correta | Safety preservado | Evidência/regressão requerida |
|---|---|---|---|---|
| P1: contexto único da clarificação | `sendSchedulingTurn`, hints/compositor e continuation múltipla diferentes | Um envelope com ação/role solicitado, accepted fields, missing, pergunta; resposta vira patch explícito | Sem execução, sem refs expostos, mesma operação/identidade | Respostas curtas por fonte/destino/fim, negativa, correção explícita, múltiplas pendências, igualdade dos campos não tocados |
| P2: projeção única de estado efetivo | `collectedActionFields` sobrepõe presentes ao plano antigo | Projetar draft validado; intenção original em evidência separada; remoção explícita, não mera ausência | Não ressuscitar dados/consentimento; revision/fingerprint/idempotência | Replay dos quatro turnos Amanda, invalidação de temporal e motivo; x49 irmãos/DAG; aprovação stale e replay |
| P3: grounding orientado a papéis existentes | `groundSchedulingTemporal` usa clocks/dates globais; patch local acrescenta um padrão numérico | Validar fonte e destino separadamente usando campos atuais e evidência da restrição; separar desconhecido de contraditório | Domingo→sábado bloqueado; troca dos clocks bloqueada; timezone/domínio mantidos | Famílias com ordem invertida, dois/diferentes dias, numeral/palavra, correção/negação, virada do dia, spans que não provam papel |
| P4: estado de capability na fronteira | discovery devolve [] para ambiguidade e unsupported; Front usa ausência de proposal | Envelope distinto para SUPPORTED/NEEDS_INPUT/AMBIGUOUS/UNSUPPORTED/BLOCKED e motivo; UI sem card fictício | Registry continua fechado; modelo não cria capacidade/permissão | Profissional/produto/financeiro write unsupported; cumprimentos; ambiguidade real; capability válida incompleta |
| P5: observação fora do caminho funcional | preloads/monkeypatches misturam capture, assertions e budget | Captura limitada isolada; assertions antes; controle de custo separado e fail-closed | Limite e journals preservados; nenhum envio externo extra | Bytes/status equivalentes com observer on/off; erro de disco/JSON/capture; sessão/abort; sem chamada real no teste de equivalência |

P1+P2 são o primeiro recorte recomendado, acompanhado da especificação de P3;
não liberar o caso de dois horários removendo o guard enquanto P3 não estiver
demonstrado. Não é necessário renomear todo o schema nem migrar banco.
Se os campos existentes não suportarem prova suficiente de papéis, uma extensão
pequena de provenance por campo pode ser proposta usando o **mesmo modelo**;
spans autodeclarados pelo modelo não são prova suficiente sem validação. Isso
deve ser medido antes de ampliar contrato, não implantado por suposição.

O patch local anterior acrescenta um padrão `das/de ... para ...` e fast path
`source_time`. Cobre o recorte relatado, mas não corrige projeção com dados antigos,
contexto ausente no caminho de Luna nem unsupported. **Não recomendar seu deploy
isolado como estabilização da classe.** Preservá-lo como trabalho anterior até a
decisão do usuário, sem removê-lo nesta auditoria.

Risco principal: reduzir falso positivo abrindo falso negativo. A validação
offline precisa provar simultaneamente preservação de informação correta e
rejeição de pares trocados, nomes indevidos, negação perdida e confirmação stale.
Não basta aumentar a quantidade de testes nem comparar só a resposta em prosa.

## 9. Evidência para voltar a desenvolver e encerrar

A pergunta “onde a informação correta está sendo perdida?” está respondida:
**grounding apaga os horários do draft; projeção mantém cópias antigas; continuação
não recebe o alvo da pergunta; o modelo escreve no outro campo; missing persiste.**

Antes de nova inferência, replay offline por fronteira com o output bruto histórico,
sem rede ou mutation, registrando diff por campo, razão, papel, draft revision e
status da proposal. Não precisa repetir chamadas para obter verde. Registros
ausentes ficam UNKNOWN. Não alterar expected nem snapshots originais.

[30 golden conversations novas](./SECRETARY_GOLDEN_FREE_USE_30.md) estão preparadas
por famílias, com pré-condições e critérios; **não executadas**. Não foram copiadas
das frases históricas, nem enviadas ao modelo em inferência. Não é possível afirmar
que nunca apareceram no treinamento do modelo; a novidade garantida é nesta bateria.
Só executá-las depois da correção de classe e regressão dos contratos históricos.

Esta auditoria não reexecutou suíte/build: somente documentos e extração de
artefatos foram produzidos. Os 2.695 testes PASS pertencem à etapa anterior e
não são uma aprovação deste plano arquitetural. D permanece UNKNOWN; E/E2 não
ganham suporte; STT físico segue pendente. Production/deploy continuam proibidos.

## 10. Referências de implementação e de evidência

- `src/lib/secretary-scheduling.ts:34,85,139,160` — prepare, missing, guard, contexto single.
- `src/lib/secretary-action-plan.ts:84` — merge do plano com campos do draft.
- `src/lib/scheduling-actions.ts:33,71,90` — assess/merge, temporal_missing, revisões.
- `src/lib/scheduling-contract.ts:9,18,26` — papéis, requisitos e resolução de data.
- `src/lib/scheduling-temporal-source.ts:19` — confronto de fonte; inclui patch local posterior.
- `src/lib/salon-secretary.ts:319,343,438,487,524` — roteamento, seleção vazia, plano, continuações.
- `packages/salon-secretary/src/index.ts:82` — SDK, validação e contexto.
- `packages/salon-secretary/src/skill-registry.ts:12,35` — catálogo e empty selection.
- `packages/salon-secretary/src/conversational-presentation.ts:32,45,110` — pergunta efetiva.
- `src/app/(admin)/servicos/secretaria/secretary-chat.tsx:153` — fallback de card sem plano.
- [Observer manual](./SECRETARY_MANUAL_OBSERVER_FIX.md), [provider manual](./SECRETARY_MANUAL_PROVIDER_FIX.md).
- [UX histórica](./SECRETARIA_CONVERSATIONAL_UX_SELF_HEALING_RESULT.md), [x49 final](./SECRETARIA_MINIMUM_CLARIFICATION_FINAL.md).
- [T21/evaluator](./SECRETARIA_TOPIC14_FINAL_RESULT.md), [x94 original preservado](./SECRETARIA_X94_COREFERENCE_AUDIT.md), [x94 depois](./SECRETARIA_X94_ORIGINAL_REASON_RESULT.md).
- [Voz automatizada](./SECRETARY_AUTOMATED_VOICE_V1.md), [temporal G validado](./SECRETARY_TEMPORAL_GROUNDING_V1.md).

Os relatórios históricos têm marcos diferentes; o status mais recente prevalece.
Não se reescrevem relatos antigos como se falhas nunca tivessem acontecido.
