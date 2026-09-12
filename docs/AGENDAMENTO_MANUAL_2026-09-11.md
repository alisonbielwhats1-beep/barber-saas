# Agendamento manual — pedidos do cliente em 11/09/2026

Atualização posterior: `PEDIDOS_CLIENTE_2026-09-11.md` amplia a edição dos
serviços e permite término após o último turno com confirmação de dono/gerente.
Substitui a restrição de término abaixo, preservando a configuração da jornada.

Base: `origin/master` `30be4b7`. Branch: `codex/client-booksy-improvements`.

Os dois áudios e o vídeo fornecidos mostram um problema específico: o menu “+”
abre a criação no primeiro horário da agenda, sem permitir editar esse início.
O cliente precisa de minutos como 09:15, 10:45 e 11:50, além de trocar a data.
O vídeo também demonstra reutilização de serviços anteriores, edição de horário,
confirmação de pausa e encaixe com sobreposição. É referência funcional; a
identidade visual e as permissões do Everflair são preservadas.

## Entrega

- Data e hora editáveis no próprio formulário, com precisão de um minuto,
  inicializadas pelo horário clicado ou pelo atalho “+”.
- O início editado é enviado como horário civil ao servidor, também para séries
  e para a confirmação de exceção. A conversão continua no fuso do salão.
- “Usar serviços da última reserva” consulta somente o tenant ativo e, para
  profissional, apenas seus atendimentos. Exclui futuro, cancelados, faltas e
  reservas de dependentes. Não copia preços antigos, observações ou dados pessoais.
- Serviços removidos/incompatíveis exigem escolha manual; o atalho não aplica
  uma parte da reserva silenciosamente. Respostas obsoletas são descartadas.
- Alterar campos invalida a confirmação anterior de conflito e a chave da
  tentativa. Falha de rede preserva escolhas e chave para retry idempotente.
- Campos bloqueados durante o envio; rótulos associados para leitores de tela.

A edição de data/hora de uma reserva já existe no detalhe e continua mantendo
o mesmo ID e o fluxo de proposta/aceite. Pausa semanal permite confirmação pelo
dono ou próprio profissional; sobreposição na criação exige dono/gerente,
confirmação e motivo. A solicitação adicional de flexibilidade autoriza dono/
gerente a criar dentro de bloqueios/folgas, com motivo, mantendo o TimeOff e
registrando auditoria. Se também existir outro atendimento, a confirmação de
sobreposição é separada. Fechamento do salão e limites da jornada permanecem.
A limitação histórica de overbooking à criação foi ampliada pelo pedido de
12/09: veja `BOOKSY_PEDIDOS_2026-09-12.md` para a edição com confirmação.

## Investigação do áudio adicional de 01:18

Relato: atendimento de sábado 15:00–18:45 e tentativa de bloqueio 18:45–19:30
indicando sobreposição. O responsável confirmou o caminho “+ → bloqueio de
horário” e que apenas 19:00 era aceito. Portanto a correção da grade abaixo é
independente e não deve ser apresentada como causa comprovada desse relato.

A grade diária passava o início fixo da linha de 30
minutos em seus eventos de clique/seleção, inclusive no trecho livre depois de
18:45. Isso podia preencher 18:30 e produzir uma sobreposição real no pedido.
O ponteiro agora resolve segmentos de cinco minutos dentro da linha; o teclado
mantém o intervalo anunciado de 30 minutos e os campos aceitam qualquer minuto.

Não foi reproduzida recusa no servidor para início digitado exatamente às
18:45: a consulta usa `startAt < fim AND endAt > início`, e bloquear preserva
reservas mesmo quando há sobreposição. Regressão da ação cobre 18:45 sem afetados
e 18:40 com um afetado, mantendo os instantes precisos no fuso do salão.
O formulário de bloqueio separa data e hora: por preferência explícita, o seletor
nativo é padrão, com passo de um minuto. A digitação numérica fica opcional:
1845 vira 18:45. O navegador exato e a recusa original não foram reproduzidos.
Nenhum registro real foi consultado.

## Flexibilidade pedida no áudio de 01:24

- Criar bloqueio sobre reservas preserva os atendimentos e mostra os afetados.
- Criar atendimento dentro de TimeOff exige dono/gerente e motivo confirmado;
  o bloqueio permanece ativo para o autoatendimento público.
- O detalhe do bloqueio oferece “Agendar mantendo bloqueio”, além de reabrir.
- Criar sobre outro atendimento mostra a confirmação de encaixe: foi corrigido
  o retorno prematuro de REASON_REQUIRED que impedia a tela de oferecer a ação.
- Pausa, bloqueio e conflito são reavaliados separadamente, sob o lock existente,
  e auditados na mesma transação. Uma confirmação não autoriza a outra.
- O formulário não permite editar os campos durante uma revisão/envio pendente,
  evitando apresentar uma resposta referente a outro intervalo.

## Verificações automatizadas

Regressões DOM cobrem horários fora da grade, séries, troca após conflito,
reutilização de serviços, resposta atrasada e retry. Testes de servidor cobrem
tenant e restrição do profissional na consulta do histórico. Jornada Playwright
abre o formulário pelo “+” em 1440, 390 e 320 px, edita data/minutos, verifica
overflow e acessibilidade e captura a interface com dados fictícios no CI.

Sem migration, escrita manual de banco ou promoção produtiva. Resultados de
lint, TypeScript, Vitest, build e CI serão registrados no PR da entrega.
