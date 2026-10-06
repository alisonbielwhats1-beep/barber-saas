# Diagnóstico manual após estabilização — 26/09/2026

Auditoria somente leitura, sem inferências novas, confirmação, mutation ou deploy.
Build observado nas respostas reais: `Rc178sgIPRIkRYhtUSoDt`, o mesmo candidato
instalado após verificação de 671 arquivos de runtime/config/schema.
Sessão: `925e025a-68e1-4ed2-8b73-c3458313f282`.

Evidência bruta preservada no Codespace:
`/workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z/manual-amanda-after-stabilization.json`.
Contém seis requests (start + cinco mensagens) e cinco outputs de provider,
todos HTTP 200, entre 16:29:51Z e 16:32:39Z. Coleta passiva existente.

## Amanda não encontrada

Mensagem: “altere a amanda para amanha as 10h”. Luna retornou
`appointment.change`, customer_name Amanda, day_offset 1, time 10:00,
seletores source nulos. Backend conservou destino 2026-09-27 10:00 e resolveu
cliente real. Não há perda temporal nesse turno.
Request `387a953a-8707-4467-8b87-2f7eacbb6254`, latência 3647 ms.

`locateSchedulingAppointments`, em `src/lib/scheduling-mutations.ts`, restringe
busca a PENDING/CONFIRMED e startAt > agora, tanto na query sem data quanto no
filtro final. `mutableSnapshot` também rejeita ALREADY_STARTED_OR_CLOSED.
A imagem fornecida mostra Amanda às 11h e 12h de 26/09 e relógio após 13h30.
Esses registros visíveis estão fora do conjunto mutável. A tela Agenda apresenta
histórico do dia; estar visível não significa elegível para remarcação pela Secretária.

Continuação “massagem”: Luna retornou service_name massagem. O mesmo plan_ref
`9345426c-0b30-4ece-8bb6-168fc94f8dd3` passou de revisão 2 para 3 e o mesmo
draft_ref `5d52528e-2722-4893-9fa9-40786cfba905` de revisão 1 para 2.
Destino permaneceu 2026-09-27 10:00; serviço foi resolvido. Nova busca vazia.
Request `10e5b968-c404-4a65-b0e4-fa2d616521d4`, latência 2046 ms.

Classificação: BACKEND_DOMAIN_REJECTION com PRESENTATION_BUG: resposta genérica
“não encontrei ... ativo” não comunica o alcance futuro, seguida da mesma pergunta
por appointment_ref. Não remover o filtro ou permitir passado sem decisão de produto.
Não há proposta executável nestes dois responses.

## Troca de assunto fica presa à remarcação

Mensagens posteriores “altere a massagem para r$ 90” e “altere o valor do serviço
massagem para r$ 90” transportaram operation_ref da remarcação
`c19477d2-9a95-4f3b-8026-cb8b8469f2ab`.
Foram interpretadas pelo schema de Scheduling (`upsert_action_draft`), que não
representa alteração de preço de serviço. Luna retornou operation/fields nulos;
pipeline repetiu a pergunta anterior e incrementou revisão do draft sem progresso.
Latências: 3299 ms e 2514 ms. Pedidos não chegaram ao fluxo Services.

`secretary-chat.tsx` mantém operationRef após envio. `sendActionPlanTurn` em
`salon-secretary.ts` usa a operação selecionada (ou única pendente) para continuar
no adapter específico. Não basta limpar operationRef no Front: a única ação
pendente também pode capturar a nova intenção no backend.

Classe estrutural: encaminhamento de continuação mantém domínio selecionado
mesmo quando a mensagem muda de intenção. Não atribuir esses outputs nulos a
incapacidade geral do modelo: ele recebeu a interface de Agenda.
Correção deve distinguir continuidade versus nova intenção antes do adapter,
preservar drafts e exigir nova proposta/confirmation; não adicionar regex por frase.
Classificação: DRAFT_STATE_BUG / roteamento conversacional, com PRESENTATION_BUG
na repetição sem explicar ausência de progresso.

## Saudação e veredito

“oi” recebeu AMBIGUOUS no registry e resposta genérica de esclarecimento.
Isso é limitação de UX conversacional, não sucesso do teste de conversa livre.

Resultado manual continua NÃO VALIDADO. Os testes offline não demonstraram
mudança de intenção livre nesta sessão real. A evidência não sustenta hipótese
de build anterior ou arquitetura ausente: o build corresponde ao instalado;
o próprio caminho de continuação implementado causa o desvio de domínio.

Este diagnóstico não altera o produto nem afirma correção publicada. Não foram
enviados comandos ao chat ou executadas confirmações pelo agente. Os responses
coletados não contêm proposta confirmável ou receipt; reconciliação global de
banco deve ocorrer ao fechamento, sem inferir zero mutation global apenas dessas
respostas. Production não acessada. Staging não desligado neste diagnóstico.
