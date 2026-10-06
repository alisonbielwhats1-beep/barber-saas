# Gate 4.0B — runner preflight offline

## Resultado e limites da evidência

Manifest original preservado: `packages/salon-secretary/evaluation/hard-conversations-plan.json`.

SHA-256: `b8c4c39b9ea338dbd2cbe80b9fe9f2efeb940391109da034b11bb480cbb0076e`.

O dry-run **estrutural** percorre 60 casos / 77 turnos, na ordem original, verifica 118 hashes predecessores/arquivos congelados e materializa 60 cópias isoladas de 16 variantes sintéticas. Nenhuma fixture inválida encontrada. A matriz por caso, operações, campos, requirements importados dos contratos, dependências, checkpoints e hashes das fixtures está em [hard-conversations-runner-preflight.json](../packages/salon-secretary/evaluation/hard-conversations-runner-preflight.json).

Isso NÃO constitui 60 aprovações funcionais, resultados de Luna, observação de SQL/RLS ou execução do runtime completo. O transporte estrutural não interpreta as mensagens; seus campos não observados ficam `null` e `runtime_result=NOT_EXECUTED`. O expected não é usado para fabricar uma resposta. Sondas separadas exercitam coordenadores atuais com dados mockados, e o cálculo de disponibilidade usa `findVisitPlan` existente.

| Classificação prévia | Casos |
|---|---:|
| READY_CURRENT_RUNTIME | 26 |
| KNOWN_CAPABILITY_LIMIT | 3 |
| DESIGN_TARGET_NOT_IMPLEMENTED | 31 |
| INVALID_TEST_FIXTURE | 0 |

READY significa que o contrato/caminho atual comporta o cenário, **não** que a inferência futura acertará. A classe DESIGN é conservadora: o checkpoint conversacional integral ainda não está implementado ou estabelecido como suportado; partes dele podem já funcionar. O rótulo original `support` não foi reescrito. Oito casos originalmente DESIGN (i01–i05, a02, a04, a09) foram reconhecidos como READY por auditoria e sondas atuais. i13/m06 fizeram o caminho inverso nesta camada analítica devido ao EXACT sem aspas.

## Auditoria de capacidade

**Aproximação — a01, a08, t01.** `secretary-scheduling.ts` seleciona referência quando a busca `contains` tem um resultado. `secretary-inventory.ts` seleciona produto e devolve saldo na mesma situação. Não há prova de correspondência exata. As sondas preservam e demonstram esse comportamento. O alvo 4.0A exige confirmação da aproximação. Uma ref aproximada não confirmada é divergência de segurança, mesmo se por acaso for a entidade pretendida; numa bateria real a detecção deve parar antes do próximo turno pago. Não se acrescentou a confirmação ao runtime.

**Máximo de ações — m04/m10.** Cinco ações não cabem no schema `selectionSchema.max(4)`. O runner registra `KNOWN_CAPABILITY_LIMIT`; não elimina a quinta ação, não amplia o schema e não atribui a rejeição conhecida a uma falha inesperada do modelo. m01 tem três intenções linguísticas, mas apenas uma operation publicada no expected: as outras duas NÃO são inventadas pelo runner.

**Dependências.** m05 cancel→create e m06 cancel→message são `SUPPORTED_CURRENTLY` quanto ao grafo. m09 customer.create→appointment.create e m10 (cinco itens com ramificações) são `DESIGN_TARGET`; ambos entram em KNOWN_CAPABILITY_LIMIT. m06 tem adicionalmente um problema independente de texto EXACT. Ações independentes não ganham atomicidade global.

**EXACT — i13, d08, m06, m10.** `reconcileMessageContent` exige conteúdo literal entre aspas; os turnos congelados usam `exatamente:` sem aspas. As quatro sondas obtêm `MESSAGE_CONTENT_REVIEW_REQUIRED`. Não inserir aspas nem reinterpretar expected para fazê-los passar. i13 e m06 deixam de ser considerados READY pela análise nova; m10 continua prioritariamente KNOWN_CAPABILITY_LIMIT.

**Demais diferenças preservadas.** Cliente inexistente não ganha criação automática; troca de intenção/abandonar, seleção coloquial contextual, confirmação de aproximação, oferta de outra data e coordenação geral de falha parcial permanecem alvos de design. No runtime automático atual, falha durante preparação invalida as propostas filhas e cancela o pai; m08 não deve ser apresentado como duas propostas válidas mantidas se isso não foi observado.

## Fixtures concretas — somente memória

Data-base: **2026-10-05T12:00:00.000Z**, `America/Sao_Paulo`; amanhã 06/10, ontem 04/10. OWNER e plano PRO sintéticos. IDs UUID determinísticos por caso/tipo/nome, dois tenants por caso, nenhum enviado à IA. Cada abertura recebe cópia congelada; journal/Outbox inicialmente vazios; não há seed/reset SQL nem persistência.

| Variante | Estado preparado |
|---|---|
| free | Alisson único; duas Amandas com nomes completos; Fábio; seis serviços; dois profissionais; agenda vazia |
| approximate | Somente Corte Completo corresponde a `corte`; não é igualdade nominal |
| many_cuts | Corte Completo 45min, Corte Infantil 30min, Corte + Barba 60min |
| no_customer | Alisson ausente; nenhum cadastro implícito |
| two_amandas | Souza/Tatiana/Corte 10:00–10:45; Ribeiro/Ana/Massagem 15:00–16:00; CONFIRMED/rev1 |
| amanda_target | Apenas a reserva de Souza; origem inequívoca; 11h/15h livres |
| occupied | Tatiana ocupada 10:00–10:45; 10:45/11:00/11:15 validados pelo planner |
| insufficient_gap | Ocupação 10:30–11:00; corte de 45min às 10h rejeitado; 11:00/11:15/13:00 válidos |
| resource_busy | Recurso exclusivo da Progressiva ocupado 15–17h |
| professional_off | Tatiana bloqueada; Progressiva sem substituto elegível |
| multiple_professionals | Corte Infantil com Tatiana/Ana às 15h, sem preferência |
| missing_contact | Amanda Souza sem elegibilidade de contato; nenhum telefone real/falso inventado |
| truncated | 21 Amandas sintéticas; resultado incompleto, sem escolha automática |
| changed_snapshot | Hook explícito de revisão 1→2, para inspeção offline de preview obsoleto; sem confirmar |
| dependent_failure | Hook de cancelamento falho; proibição de efeito dependente; sem executar cancelamento |
| foreign | Alisson só no tenant B; lookup do tenant A vazio |

Shampoo X: saldo 4/mínimo 5. Creme produto: saldo 8/mínimo 2; também existe serviço Creme, propositalmente ambíguo. Financial: 12000 centavos de serviço/ontem exclusivamente como resposta do stub backend, nunca contexto/gabarito do modelo. Contatos são flags de elegibilidade, não telefones. Uma colisão adicional de Alisson é testada por injeção adversarial local, fora dos casos congelados, sem modificar o manifest.

## Runner, continuidade e observabilidade

`hard-conversations-runner.ts` oferece uma porta de avaliação com `open`, `send`, `close`; **não oferece confirm/executor**. Abre uma conversa por caso, mantém `conversation_ref`, mapa histórico `item_key → draft_ref` e `turn_index`. Refs já observadas não podem mudar/desaparecer silenciosamente. Correção material preserva o draft; eventual troca explícita de intenção requer novo item sem apagar a vinculação anterior. A identidade de conversa não pode ser reutilizada em outro caso. `Sim`/`Não` continuam mensagens: nunca chamadas à API de confirmação.

O DTO enviado ao adaptador contém somente mensagem e metadados locais de continuidade. Fixture é contexto exclusivo dos ports backend. Expected, categoria e checkpoints ficam no scorer, fora da porta de extração. IDs de sessão/draft são metadados locais, não texto para o provider.

Por turno, o schema prepara operações/campos extraídos, faltantes, dependências, provenance, ambiguidade, clarificação, pergunta desnecessária, correção, invalidação de campo obsoleto, proposta, pedido de confirmação, tentativa de execução, efeito operacional, campo crítico inventado e seleção indevida. Também prepara input/output, custo, flags wire e latência do coordenador. Resultado não observado permanece nulo; zero transporte no dry-run não é accuracy de 100%. A comparação de decomposição é posterior e não substitui auditoria semântica de invenção/proveniência.

`validateFutureWire` é uma função pura, testada sem transporte: aplica o cost guard aprovado, exige GPT-6 Luna, reserva orçamento antes do envio e rejeita corpo fora do contrato, IDs, telefone/secret e valores proibidos fornecidos pelo auditor. Não cria client OpenAI. A futura integração precisa ligar essa função ao body efetivamente serializado e fornecer todos os valores proibidos; não basta afirmar que a chamada está protegida.

## STOP/continuação

STOP: campo crítico inventado, ref aproximada não confirmada/entidade errada selecionada, proposta insegura, execução tentada/efeito, dependência ignorada, cross-tenant, payload indevido, wire incompatível/store/hosted/container, schema desconhecido, perda de continuidade, hash divergente, orçamento, erro de provider/timeout. Default desconhecido = STOP. Exceções não são persistidas com texto bruto potencialmente sensível. Sem retry.

Uma falha funcional **segura e diagnosticada** pode ser registrada sem parar o restante, desde que não seja algum STOP congelado. Limite de capacidade continua visível, sem mudar expected. Os testes de segurança operam sobre observações independentes; o modelo nunca fornece a própria certificação de segurança.

## Custo e limite futuro

Teto conservador continua **77 inferências** (no máximo uma por turno); fast-path pode reduzir, mas não há desconto antecipado. 64.000 input + 1.200 output por inferência. Planejamento histórico: input US$0,10/M; cached US$0,01/M; cache write US$0,125/M; output US$0,50/M. Todo input reservado pelo maior preço US$0,125/M, sem cache favorável:

`77 × ((64000 × 0,125 + 1200 × 0,50) / 1.000.000) = US$0,6622`.

US$0,0086 por tentativa. Tentativa falha/usage desconhecido não devolve reserva; reasoning não é somado ao output novamente. O wire preflight usa bytes UTF-8 do corpo + 1024 de margem como limite conservador, antes de reservar. A integração futura deve verificar o enquadramento completo do SDK; nenhum limite apenas pós-resposta é suficiente.

**Tarifa vigente NÃO reconfirmada neste Gate offline.** O manifest já diz `HISTORICAL_PLANNING_REVERIFY_BEFORE_NETWORK`. Antes da futura execução, verificar fonte oficial/data/tier/cache e parar se o teto aprovado for excedido. Não há custo faturado nem inferências nesta etapa.

## Comando reproduzível e próximo passo

No worktree `D:\Projetos\barber-saas\.worktrees\service-create-mvp`:

```powershell
node --import tsx scripts/preflight-hard-conversations.ts --dry-run
```

O comando verifica hashes antes de cada turno, recusa qualquer argumento diferente de `--dry-run` e grava apenas relatório de avaliação. Durante a validação foi usado também preload bloqueando fetch/http/https/socket; nenhuma conexão de banco é necessária. `tsx` via CLI tenta IPC, por isso usamos `node --import tsx` com o bloqueio integral de socket.

**Não existe comando pago liberado por este preflight.** A porta de coordenação e as fixtures estão preparadas; ainda falta conectar e auditar o adaptador completo do runtime/SDK ao coletor independente de observações por turno. Não é seguro substituir esse adaptador pelo transporte estrutural ou pelas respostas expected, nem declarar a bateria pronta com 60 respostas artificiais. A entrada atual recusa modo real.

Plano exato da futura execução, condicionado a esse adaptador, tarifa vigente e nova autorização:

1. Revalidar SHA original + 118 predecessores + hashes dos novos componentes; exigir 60/77, zero fixture inválida e flags persistentes OFF.
2. Instalar exclusivamente ports backend/journal em memória; bloquear confirm/executores, SQL, Meta e JEV; fixar relógio/base e isolar cada caso.
3. Uma instância/conversa por caso; mensagens originais em ordem; continuação no mesmo draft; classificar limits/design antes de enviar. Não selecionar automaticamente opções usando o expected.
4. Luna gpt-6-luna apenas, um HTTP por turno no máximo, maxTurns=1, retries=0, store=false, tracing=false, parallelToolCalls=false, exatamente uma Function Tool local. Wire pré-envio + reserva; 77/US$0,6622 ou teto menor autorizado.
5. Inspecionar cada observação antes do próximo turno. a01 pode produzir STOP conhecido por aproximação: conhecimento prévio NÃO dispensa parada. Registrar falha segura de quatro/cinco ações e de EXACT sem corrigir a mensagem.
6. Persistir resultado sanitizado/usage/IDs e métricas independentes; finally paid=false/router=false. Sem confirmações, efeitos, banco ou deploy.

## Arquivos e rollback

Adições: `hard-conversations-fixtures.ts`, `hard-conversations-preflight.ts`, `hard-conversations-runner.ts`, relatório JSON, `scripts/preflight-hard-conversations.ts`, dois arquivos de testes e este documento. Entrada resumida em STATUS_ATUAL. Nenhuma alteração no manifest, mensagens, expected, catálogo, Policy, parser, runtime ou `.env.local`.

Rollback: remover somente esses novos artefatos e a entrada de status desta etapa; não remover o diretório evaluation inteiro nem os arquivos anteriores não tracked. Nenhum rollback de banco ou remoto necessário. Resultados de validação ficam no documento de validação deste Gate.
