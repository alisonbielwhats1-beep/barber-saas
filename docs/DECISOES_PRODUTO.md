# Decisões de produto para as próximas fases

## 06/10/2026 — custo e cobrança da Secretária

A Secretária usa só dois serviços pagos: o DeepSeek V4.1 Flash (OpenRouter) para
entender os pedidos e o GPT Transcribe (OpenAI) para a voz. O Jev não é usado
na Secretária. Cada salão tem uma carteira mensal única, que soma os dois, com
um teto diário de segurança.

A cobrança será pré-paga e valerá para todos os planos: pacotes fixos
(R$ 15, R$ 25 e R$ 40) pagos por Mercado Pago ou Pix, convertidos em pedidos
(cada mensagem enviada à Secretária, digitada ou falada). A meta é 90% de
margem sem ficar caro para o cliente. O ponto de partida é R$ 0,06 por pedido
(R$ 15 = 250 pedidos), e o preço final só é fixado depois de cerca de uma semana
de custo real no piloto (relatório do HQ). A voz é o que mais pesa no custo. Se
a margem medida ficar abaixo da meta, as opções são subir o preço do pedido,
contar o pedido por voz como dois ou voltar para a transcrição mini; a escolha
fica com o responsável. Isto substitui a linha "Preço/consumo da futura IA não
estão definidos".

Complemento do mesmo dia: o cliente compra crédito, não uma quantidade fixa
de pedidos. Cada pedido desconta o próprio custo real (DeepSeek e cada
gravação transcrita) vezes 10, então a margem de 90% vale em todo pedido. A
quantidade de pedidos de um pacote é só uma estimativa ("cerca de"). A tela
mostra apenas a barra e a porcentagem, sem valores, contagem ou dias. Os
pacotes são R$ 15 (cerca de 185 pedidos), R$ 25 (cerca de 340), R$ 40 (cerca
de 600) e R$ 80 (cerca de 1.300): pacote maior rende mais. Todo salão tem uma
franquia grátis de cerca de 20 pedidos por mês, que não acumula. A recarga
soma ao saldo, o crédito não expira e só o dono recarrega. Regras e passos:
`docs/SECRETARY_CREDITS.md`.

## 03/10/2026 — motivo do cancelamento de reserva opcional

O responsável decidiu que o motivo não é necessário para cancelar uma reserva.
Dono e gerente cancelam pela agenda (detalhe da reserva e cancelamento em lote)
sem preencher motivo, e a Secretária deixa de perguntá-lo. Quando informado, o
motivo continua no histórico e aparece para o cliente; sem motivo,
`cancelledReason` e o evento ficam nulos, como já acontece quando o próprio
cliente cancela. Continuam iguais: confirmação explícita, ator e evento
imutáveis no histórico, horário liberado sem apagar o agendamento e fila
preservada. O motivo do encaixe (sobreposição, folga e após o expediente)
continua obrigatório. Substitui "confirmação e motivo" da política de
cancelamento e o "motivo obrigatório" registrado em 12/09.

## 04/10/2026 — redução automática para contratos acima da tabela

Aplicação da regra de 03/10: quando a tabela fica mais barata que o valor de um
contrato (hoje, Individual de R$ 59,90 ou R$ 599 contratado antes de 02/10), a
plataforma agenda a redução para o próximo vencimento, sem ação do dono. O
período já pago não muda e não há reembolso. Contratos mensais recebem a redução
no período corrente; anuais, só no último mês antes da renovação, para não travar
trocas de plano o ano todo. Preço de tabela que sobe nunca alcança contrato
existente. Durante a redução agendada o dono vê "Seu plano ficou mais barato" e
pode usar "Mudar de plano agora": a redução é desfeita no Mercado Pago, o plano
escolhido segue a tabela atual e, se ele não trocar, a redução volta no
vencimento seguinte. Se a plataforma não conseguir enviar o novo valor antes do
vencimento, a redução fica para o período seguinte, sem revisão financeira.
## 04/10/2026 — calendário da visita com vários serviços

Aprovado pelo responsável com as recomendações técnicas: a visita com vários
serviços **continua sem fila de espera**; o calendário abre no primeiro dia em
que a visita inteira cabe e desativa apenas os dias sem atendimento possível
(folga, fechamento, nenhum profissional do serviço trabalhando). Dias com
expediente mas lotados para a visita completa continuam clicáveis, para não
pesar a consulta quando o cliente escolhe "Sem preferência".

## 03/10/2026 — coerência de preços após a mudança de tabela

Recomendação aceita pelo responsável depois da validação com vários agentes:
preço que cai vale para todos a partir da próxima renovação; preço que sobe vale
só para novas contratações e para quem altera o próprio plano, sempre com aviso
antes de confirmar. A redução para quem paga o Individual a R$ 59,90 será feita
em uma entrega separada, depois da margem de renovação abaixo estar em produção.

- Contratação ainda não paga, criada por um preço anterior e não autorizada no
  Mercado Pago, não é paga como está: o painel oferece "Atualizar para o novo
  preço", que encerra a tentativa sem cobrança e cria outra pelo valor atual.
- Agendas adicionais contratadas a R$ 15 mantêm esse valor enquanto a
  quantidade não muda. Ao alterar, a quantidade nova segue a tabela vigente; a
  revisão avisa quando a renovação sobe e o botão só se chama "Reduzir" quando
  capacidade e valor diminuem.
- O card do plano atual mostra o valor contratado, não o da tabela.
- Renovação debitada até três dias antes do vencimento é reconhecida pelo preço
  já agendado no Mercado Pago; fora disso, a conferência continua exata.

## 03/10/2026 — calendário do cliente abre no primeiro dia com vaga

Pedido do responsável: ao marcar um horário, o calendário do cliente abre no
**primeiro dia com pelo menos um horário livre**, não em um dia que só tem fila.
Dias sem atendimento (folga semanal como a segunda-feira, fechamento, folga do
profissional, jornada já encerrada) ficam desativados. Dia **lotado que só tem
fila continua clicável**: o cliente pode voltar nele e entrar na fila de um
horário ocupado; ele recebe um ponto âmbar e a legenda "Dia lotado". Uma data
escolhida pelo cliente ou vinda de link/retorno do login é mantida se tiver
vaga ou, no caso de dia lotado, fila. Se a consulta dos dias falhar, o
calendário volta a deixar toda a janela clicável. A tela de vários serviços
na mesma reserva foi tratada em 04/10 (acima).

## 03/10/2026 — fila de espera atendida em outro horário

Pedido do dono (áudio de 30/09): quem está na fila de um horário ocupado pode ser
agendado pela gestão (dono/gerente) **em outro horário livre**, sem remover e
recadastrar. A reserva nova e a saída da fila acontecem na mesma transação. A
entrada fica como atendida (`fulfilledAppointmentId`) e não como cancelada, com
registro em auditoria. Conta e convidado são preservados.

O cancelamento pela equipe continua **não promovendo ninguém sozinho**. A opção
"cancelar e passar o horário ao #1 da fila" é a confirmação explícita da
equipe, numa única ação: revalida a vaga e, se não servir, nada é cancelado.
As sugestões de horários livres da equipe usam o mesmo cálculo público, sem a
antecedência mínima/máxima do cliente; digitar outro horário e as exceções de
encaixe continuam disponíveis.

## 02/10/2026 — novo preço do Individual e da agenda adicional

A pedido do responsável, Individual passa de R$ 59,90 para R$ 39,90/mês e a
agenda adicional (acima de dez, somente Equipe · 10 agendas) de R$ 15 para
R$ 20/mês. Anuais seguem as regras já aprovadas: Individual R$ 399 (dez
mensalidades, valor inteiro) e adicional R$ 192/ano (20% sobre doze meses).
Catálogo 2026-10-02, somente para novas contratações; contratos anteriores
continuam cobrando o preço persistido. Demais planos permanecem iguais.
## 27/09/2026 — reativar renovação e confirmação imediata

O responsável aprovou a recomendação baseada em Stripe, Spotify, Netflix e
lojas de aplicativos: enquanto o período pago estiver vigente, o proprietário
pode **reativar a renovação cancelada** pelo painel. Como o Mercado Pago não
revive uma recorrência cancelada, a reativação cria uma nova autorização com o
mesmo plano e valor, iniciando exatamente no fim do período pago; nada é
cobrado antes dessa data. Exige pelo menos uma hora restante, nenhuma revisão
financeira e capacidade compatível. Sem autorização em 24 horas, é descartada
sem efeito. Complementa a decisão de 13/09 sobre cancelamento livre: cancelar
continua encerrando as recorrências no provedor (não se usa "pausar").

Antes de cancelar, o portal oferece reduzir para um plano menor que ainda
caiba na equipe (vale no próximo vencimento). Webhooks, ações do proprietário e
o retorno do checkout passam a processar na hora a assinatura afetada; a
reconciliação agendada permanece como rede de segurança. Trocar o agendamento
para `pg_cron` do Supabase exige SQL em Production e autorização própria.

## 20/09/2026 — identidade única e recuperação Supabase

O responsável aprovou uma identidade/senha por e-mail entre painel e clientes,
mantendo perfis, históricos e autorizações separados. A candidata usa Supabase
Auth com SMTP Resend; substitui o recovery próprio apenas quando ativada.
A orientação final aprova publicação preservando senhas atuais, mesmo quando
um e-mail tem senhas diferentes em contas distintas. A migração acontece apenas
ao concluir voluntariamente uma recuperação: a nova senha passa a valer nos
acessos desse e-mail. Pedir/ignorar o link não muda senha nem sessão. Preservar
IDs, reservas, histórico e permissões; não importar nem exigir confirmação em massa.
Plano e impacto em `FASE_SUPABASE_AUTH_RECOVERY.md`.

## Visitas e autonomia — decisão de 13/09/2026

- Cliente e equipe podem reservar vários serviços com profissionais diferentes
  em uma jornada e uma confirmação; a visita inteira deve ser gravada ou recusada.
- Até dez serviços, com seleção de profissional por item. O padrão é sequência;
  simultaneidade pública depende de combinações habilitadas pelo salão e de
  profissionais diferentes. A equipe pode definir horários próprios por item.
- Profissional tem autonomia para criar/editar os próprios atendimentos em folga,
  intervalo, bloqueio pessoal e fora do expediente, com confirmação e motivo.
  Dono/gerente também. Recepção mantém a jornada normal. Isso amplia a exceção
  anterior de apenas terminar após o expediente; não concede acesso à agenda de
  outro profissional nem autorização de sobreposição ao profissional.
- Profissional pode registrar, editar e reabrir suas próprias folgas/bloqueios,
  inclusive recorrentes. Reservas existentes permanecem; bloquear não cancela.
- Fechamento geral do salão permanece bloqueado. Alterações da equipe são
  aplicadas imediatamente com resposta posterior do cliente (decisão abaixo).
  O histórico é preservado. Bloqueios após expediente devem
  aparecer na grade, com opção de visualizar o dia inteiro.
- Cadastro público no salão já deve aparecer ao dono antes da primeira reserva,
  mantendo as regras existentes de clientes ocultados/unificados.

## 13/09/2026 — cancelamento livre da renovação

O proprietário pode cancelar pelo aplicativo, sem motivo obrigatório, suporte
ou aprovação administrativa. Confirmar encerra as recorrências vinculadas no
Mercado Pago, incluindo uma substituta futura de troca mensal/anual. A tela só
declara conclusão após confirmação do provedor; falhas conservam a intenção e
continuam sendo tentadas pela fila. O cancelamento não solicita estorno.

O período já pago permanece: contratação mensal em 13/09 e cancelamento em
20/09 mantém todos os recursos contratados até o vencimento original em 13/10;
na contratação anual, até 13/09 do ano seguinte. Vale o instante exato da
expiração, exibido no fuso do estabelecimento. Não acrescentar carência após
um período cancelado nem apagar agendamentos, pagamentos ou histórico.
Suspensão administrativa não é desfeita pelo pagamento ou cancelamento, mas
o proprietário continua podendo encerrar a cobrança na tela de acesso bloqueado.

## 13/09/2026 — upgrade proporcional e troca na renovação

O responsável confirmou: “Sim, seguir essa regra”. No mesmo ciclo, aumento
de capacidade com aumento de preço libera o plano após pagamento da diferença
proporcional ao tempo restante, preservando vencimento. Vale para todos os
planos e agendas adicionais. Reduções e qualquer mudança mensal/anual ficam
para a próxima renovação, após pagamento correspondente. Profissionais ativos
e convites pendentes devem caber no destino; a troca reserva esse limite.
Os termos anteriores e o histórico financeiro são preservados. O proprietário
revê cobrança adicional, próxima recorrência e vigência antes de confirmar.
Trocar o ciclo exige nova autorização: a recorrência anterior é encerrada
antes de liberar o link novo, preservando acesso já pago. A tela explica que
abandonar essa autorização interrompe a renovação automática ao fim do período.
Esta decisão substitui a ausência de prorrata/trocas no escopo inicial abaixo.
Não existe aprovação manual para cliente novo: cadastro aprovado e plano pago
liberado automaticamente por confirmação financeira. Suspensão é independente.

## 13/09/2026 — composição aprovada dos planos na landing

Retomada da referência visual aprovada na conversa “Avaliar integração com
Mercado Pago”: quatro cards, Individual, Essencial, Equipe e Everflair IA.
Equipe reúne as opções de 5 e 10 agendas em um seletor, com degradê violeta
suave, clareado a pedido do responsável para #634b7f a #80629b.
IA permanece “Em breve”, com prévia ilustrativa,
cadeado e botão desativado, sem preço, contratação ou promessa de lançamento.
Os códigos internos INDIVIDUAL/TEAM/TEAM_PLUS/TEAM_MAX e capacidades
permanecem iguais. A pedido do responsável, os totais anuais passam a valores
inteiros: R$ 599, R$ 779, R$ 959 e R$ 1.439. Catálogo 2026-09-13, aplicável
somente a novas contratações; os preços persistidos nos contratos anteriores
continuam sendo a fonte da cobrança. Mensais e adicional anual de R$ 144
permanecem iguais. Os nomes públicos são Individual, Essencial, Equipe · 5
agendas e Equipe · 10 agendas. Adicionais só na opção de 10 agendas.
Preço/consumo da futura IA não estão definidos nem incluídos na assinatura.

## 12/09/2026 — assinaturas Mercado Pago autorizadas para implementação

Catálogo, periodicidade mensal/anual, capacidades e preços aprovados estão em
`MERCADOPAGO_ASSINATURAS.md`. Preço anual é total cobrado a cada doze meses;
todos os planos pagos têm os mesmos recursos. Pagamento aprovado libera o
período; autorização do cartão/assinatura e retorno do checkout não liberam.
Falha confirmada permite carência de cinco dias, depois restringe novas reservas
e agendas, preservando histórico e atendimento existente. Cancelamento impede
renovações após confirmação do provedor e preserva acesso ao período pago.
Sem conversão automática de contratos antigos, prorrata ou mudança no meio do
ciclo nesta entrega. Aprovação/suspensão administrativa permanece independente.
Implementar e revisar não autoriza migration ou ativação em Production.

## Recebimentos e agendamento — decisão de 13/09/2026

- Financeiro reúne pendências pelo dia do atendimento e recebimentos com recibos.
  Hoje oferece baixa rápida; somente Financeiro mostra o histórico de dias.
- Data do recebimento começa sempre em ontem no fuso do salão e pode ser alterada.
  Seleção confirma pagamentos; desmarcar mantém a pendência. Concluir atendimento
  sem pagamento não lança receita. Baixa de atendimento não concluído exige
  confirmação explícita de que foi realizado.
- Extras de serviço e acréscimos com motivo são registrados no pagamento, sem
  mudar o preço reservado ou o catálogo. Receita recebida usa o valor final.
- Remover abas Pagamentos e Fechamento e abertura/fechamento operacional de caixa.
  Remover sinais fictícios de 30%, que só alteravam auditoria sem compensação
  financeira. Preservar históricos existentes; não adicionar cobrança automática.
- Até dez itens, inclusive serviços repetidos, na mesma reserva, consecutivos
  com o mesmo profissional. Dono/gerente mantêm encaixe explícito com motivo.
- Cores por serviço (padrão), categoria, status ou profissional; preferência local
  por salão e usuário. Rótulo de status permanece. Vários serviços usam o primeiro.
- Último atendimento concluído preenche nova seleção, com preços/disponibilidade
  atuais. Complementos são opcionais e usam serviços reais do catálogo.
- Gestão configura retorno padrão/por serviço e destaque dos melhores encaixes.
  Todos os horários disponíveis continuam acessíveis. Retornos são estimativas,
  não notificações automáticas; contatos dependem de ação humana.
- Oferta da fila é iniciada pela gestão, respeita ordem compatível e tem prazo de
  5–60 minutos. Aceite do titular confirma uma única reserva; recusa/expiração
  libera a vaga. A gestão pode ofertar ao próximo compatível ou retirar uma oferta.
  O pedido recusado continua elegível para outros horários.


Estas decisões consolidam as respostas do responsável pelo produto e as
recomendações técnicas adotadas. Elas orientam a implementação; não significam
que todos os itens abaixo já estão implementados na Fase 1.

## Aparência administrativa — revisão de 07/09/2026

Decisão de 12/09/2026 para clientes: somente o proprietário pode excluir um
cliente da lista ativa e restaurá-lo. Excluir da lista não revoga acesso,
não impede novos agendamentos e não apaga perfil, pagamentos ou histórico.
O responsável confirmou: “Só excluir da lista, preservando o acesso”.
As operações são tenant-scoped e registradas na auditoria.

Complemento solicitado em 12/09: perfis excluídos da lista e já mesclados não
aparecem no seletor de cliente para agendamento manual. A exclusão da lista
continua preservando acesso e autoagendamento do cliente. Duplicatas mostram
qual perfil tem conta, recomendando mantê-lo quando só um possui acesso.

Fundos escuros em grafite neutro, sem roxo dominante. Após nova solicitação,
o tema claro substitui marfim/pedra por cinza quase branco frio (`#F6F7F9`),
cartões brancos, contornos suaves e sombras discretas para separar os painéis.
Campos mantêm bordas mais definidas e foco visível.
Botões principais verdes, próximo atendimento verde, execução azul,
pendências âmbar e avisos críticos vermelhos. Lilás restrito à marca e seleção.
Cores de serviços continuam sendo categorias, sem substituir os estados.
Após revisão do tema claro, o próximo atendimento recebe verde sólido da
marca com texto claro. Indicadores e próximas ações ganham acentos semânticos
mais presentes; cobre diferencia ocupação. Os fundos gerais continuam neutros.
O menu expandido exibe símbolo e nome; recolhido, somente símbolo. Controle de
tema no topo, inclusive no celular. Ver `CORES_E_APRESENTACAO_2026-09-07.md`.

## Aparência do aplicativo do cliente — revisão de 07/09/2026

Revisão autorizada em 08/09: seletor claro/escuro no topo do cliente, preferência
independente do painel e restaurada antes da primeira pintura. Marca menor nas
telas de acesso; animação deve aparecer antes do acesso, nunca depois de uma
piscada de login. Catálogo e disponibilidade consultáveis sem conta; autenticação
continua obrigatória para confirmar, entrar em fila ou consultar dados pessoais.
Lista compacta de serviços por categoria, progresso, resumo e retorno preservado;
avaliação do salão em destaque após atendimento concluído. Ver
`CLIENTE_AGENDAMENTO_CLARO_2026-09-08.md`.

Por solicitação do responsável, a entrada do cliente usa fundo grafite com
movimento verde/lilás e marca clara. Agendamento e botões principais verdes;
contatos recebem cores reconhecíveis. Reservas confirmadas têm bloco verde,
canceladas vermelho, pendentes âmbar e em atendimento azul. Texto e ícone
continuam explicitando o estado. Ver `CLIENTE_CORES_ENTRADA_2026-09-07.md`.

O ícone de instalação usa o símbolo Flair do Everflair em lilás claro sobre
grafite, compartilhado entre painel e estabelecimentos. Não usa iniciais nem
a foto do salão. Nome e destino do atalho continuam identificando o
estabelecimento. Ver `ICONE_INSTALACAO_2026-09-07.md`.

Após nova solicitação, cabeçalho e telas de acesso do cliente usam a marca
Everflair completa, sem área de foto circular, iniciais ou ampliação/lupa.
Nome do estabelecimento permanece legível em linha própria. Boas-vindas,
login e cadastro compartilham o mesmo padrão grafite/verde/lilás e respeitam
áreas seguras do celular. Serviços e categorias são apresentados sem fotos;
retratos dos profissionais, produtos e portfólio permanecem. Esta decisão
substitui a ampliação de logo e as fotos de categorias/serviços anteriores.
Ver `CLIENTE_RESPONSIVO_2026-09-07.md`.

## Cores da agenda por profissional — revisão de 07/09/2026

Por solicitação do responsável, a cor principal dos cartões identifica o
profissional, em todas as visões e em ambos os temas. O status usa indicador,
selo e texto; conflitos permanecem destacados em vermelho e bloqueios
hachurados. Esta decisão substitui o uso de status como fundo/faixa do cartão
da agenda, sem alterar sua semântica nas demais áreas.
Ver `AGENDA_CORES_PROFISSIONAIS_2026-09-07.md`.

## Permissões

Matriz recomendada, baseada em privilégio mínimo:

| Papel | Agenda | Clientes | Serviços/equipe | Financeiro |
|---|---|---|---|---|
| Dono | Todos os profissionais e unidades | Todos do tenant | Administração completa | Completo |
| Gerente/administrador | Todos conforme unidade autorizada | Todos da unidade | Operacional | Completo, salvo futura restrição do dono |
| Recepção | Todos para operar agenda | Cadastro e contato | Somente leitura necessária | Sem relatórios, despesas ou comissões; pode apenas registrar a forma recebida no checkout |
| Profissional | Somente a própria agenda | Somente clientes ligados aos próprios atendimentos | Próprio perfil | Sem acesso |
| Cliente | Somente os próprios agendamentos | Próprio perfil | Catálogo público | Somente os próprios comprovantes, se existirem |

Toda leitura e escrita deve validar `salonId`, papel e, quando aplicável,
`professionalId` no servidor. Ocultar um botão não é autorização.

## Override

Atualização do pedido de correções de 11/09/2026: dono/gerente podem confirmar
uma reserva com início dentro do último turno e término após ele, no mesmo dia,
sem mudar o fechamento cadastrado. Exige motivo e auditoria; vale para criação
e edição, com autorização persistida se houver aceite do cliente. Não autoriza
início após o expediente, dia sem jornada, fechamento explícito nem dispensa
outras restrições. Detalhes em `PEDIDOS_CLIENTE_2026-09-11.md`. Esta exceção
substitui apenas a proibição de extrapolar o término nas decisões anteriores.

Atualização autorizada em 11/09/2026 pelos áudios e pedido de flexibilidade:
na criação manual, dono/gerente podem agendar dentro de TimeOff (bloqueio/folga)
com confirmação e motivo, preservando o bloqueio para o público e registrando
auditoria. Havendo também sobreposição ou pausa, cada exceção exige confirmação
própria. Criar um bloqueio pode cobrir reservas existentes, sem cancelá-las.
Não altera a restrição de fechamento absoluto, limites da jornada, permissões
do autoatendimento nem o fluxo de remarcação. Ver `AGENDAMENTO_MANUAL_2026-09-11.md`.

Override é uma exceção deliberada a uma regra operacional, por exemplo agendar
fora do horário de trabalho ou com antecedência menor que a política normal.

Decisão:

- somente dono e gerente podem usar;
- exige confirmação, motivo e registro imutável do responsável;
- o cliente precisa visualizar o horário real;
- nunca ignora tenant, autenticação, integridade dos dados ou transições de
  status;
- fechamento absoluto do estabelecimento só pode ser ignorado por uma ação
  explícita distinta.

## Overbooking

Atualização de 12/09/2026: o vídeo de 01:02:44 pede encaixe também ao editar uma
reserva existente. Dono/gerente podem confirmar a sobreposição com motivo,
sem apagar a reserva vizinha. Cliente com conta continua recebendo proposta;
a autorização fica persistida no servidor e é revalidada no aceite. Público,
recepção e profissional não ganham essa exceção. Bloqueios, pausas, fechamento
e recursos continuam independentes. Ver `BOOKSY_PEDIDOS_2026-09-12.md`.

Overbooking é manter dois atendimentos sobrepostos para o mesmo profissional.
Isso é diferente de dois profissionais atenderem no mesmo horário.

Decisão recomendada:

- desabilitado por padrão;
- conflito acidental sempre bloqueado no banco;
- encaixe deliberado está disponível na criação manual e edição para
  dono/gerente, depois de um conflito real, com confirmação, motivo e
  auditoria;
- encaixe não ignora fechamento, jornada ou isolamento de tenant; bloqueio/folga
  exige a confirmação adicional de TimeOff descrita acima;
- lista de espera é a opção preferencial;
- nunca disponível no aplicativo do cliente.

## Reagendamento

Manter o mesmo `appointment_id` e gravar um evento imutável com valores antigo
e novo. Essa opção preserva links, pagamento e referências já existentes e é a
mais segura para a arquitetura atual.

No painel, pode trocar data, horário, profissional e serviços. No aplicativo
do cliente, a versão atual permite trocar data/horário e profissional,
preservando serviços, preços e durações contratados. Toda operação:

1. recalcule duração e preço no servidor;
2. valide todas as relações dentro do mesmo tenant;
3. bloqueie o novo intervalo de forma transacional;
4. preserve integralmente o horário antigo se qualquer etapa falhar;
5. registre quem alterou e o motivo;
6. gere exatamente um evento de notificação;
7. apresente resumo anterior/novo antes da confirmação.

Se futuramente houver pagamento online e a troca alterar o valor, será
necessário um fluxo explícito de diferença/estorno antes de liberar a ação.

## Cancelamento e no-show

- Não cobrar taxa de cancelamento nem de no-show nesta versão.
- Política padrão recomendada: cancelamento/reagendamento pelo cliente até 2
  horas antes, configurável pelo estabelecimento.
- Após o limite, o cliente entra em contato com o estabelecimento; não há
  cobrança automática.
- Dono/gerente podem cancelar antes do início com confirmação; o motivo é
  opcional desde 03/10/2026.
- Cancelamento nunca apaga o agendamento.
- O intervalo é liberado, mas o evento e o responsável permanecem no histórico.
- No-show é um status próprio, aplicado pelo estabelecimento, e não um delete.

Atualização da operação de fila (fase 016):

- cancelamento feito pelo cliente continua podendo confirmar automaticamente o
  primeiro item válido;
- cancelamento feito pelo dono/gerente preserva a fila ativa e não promove
  ninguém sozinho, pois a equipe precisa confirmar que o horário continua
  adequado;
- dono/gerente podem promover somente a primeira posição, com uma nova
  validação de profissional, jornada, folga, fechamento, buffer e conflito;
- remover uma pessoa da fila continua sendo uma ação individual e auditável.

## Estoque

Usar um livro-razão de movimentos, não apenas sobrescrever o número atual:
entrada, venda, consumo, ajuste, reserva, liberação e perda. Cada movimento
registra tenant, unidade, item, quantidade, responsável, origem e data.

- Produto vendido: baixar na confirmação da venda/checkout.
- Insumo consumido por serviço: baixar ao concluir, com possibilidade de ajuste.
- Item escasso explicitamente associado ao atendimento: pode ser reservado no
  agendamento e liberado no cancelamento.
- Bloquear estoque negativo por padrão; override exige dono/gerente e auditoria.

Decisão operacional adotada na candidata wave1, ainda pendente de CI/deploy:

- locks seguem ordem global `appointment → professional → product`, com ids
  ordenados, para evitar deadlock entre reserva, comanda, cancelamento e ajuste;
- produto escolhido no agendamento público é reservado atomicamente com o
  atendimento; retry idempotente não repete o débito;
- a comanda reconcilia a quantidade final contra a reserva: unidades mantidas
  conservam o preço reservado, adicionais usam o preço atual, redução devolve
  somente o delta e cancelamento devolve no máximo uma vez;
- todo movimento grava saldo anterior/novo, origem, atendimento e ator/motivo
  quando aplicável no `AuditLog`;
- `AppointmentProduct` ainda requer uma migration com `salonId` e constraints
  tenant-aware. Até lá, o serviço central valida appointment e produto pelo
  mesmo tenant dentro da transação; isso não substitui a defesa no banco.

## Financeiro

Não misturar métricas diferentes:

- `previsto`: agendamentos ativos futuros;
- `realizado`: serviços concluídos, mesmo ainda não recebidos;
- `recebido`: pagamentos efetivamente registrados;
- `estornado/revertido`: movimento compensatório, nunca exclusão.

Comissão recomendada: nasce após conclusão do serviço e usa o valor líquido do
serviço. Produtos e gorjetas ficam separados. Regras de pacote, assinatura e
cupom exigem decisão específica antes de implementação.

Como ainda não há cobrança online, cancelamento de algo marcado manualmente
como pago deve criar uma reversão e uma tarefa de devolução manual; nunca apagar
o pagamento original.

Para comanda manual, o `Payment` persistido é a fonte do recebido e o fechamento
é idempotente. O recibo pode apresentar snapshots de serviço e de preço/
quantidade de produto, mas não deve ser tratado como documento fiscal: nome do
produto e moeda ainda não são snapshots persistidos. Essa dívida exige migration
aditiva e decisão fiscal explícita antes de qualquer promessa comercial.

## Notificações

Estratégia sem novo custo obrigatório:

- notificação interna automática via outbox idempotente;
- e-mail automático usando a abstração Resend já existente, atrás de feature
  flag e apenas quando configurado;
- botão manual de WhatsApp com mensagem pré-preenchida;
- automação oficial de WhatsApp/SMS não será adicionada sem autorização de
  custo e fornecedor;
- falha de notificação não desfaz o agendamento e permanece disponível para
  nova tentativa.

Atualização autorizada pelo áudio de 13/09/2026 às 21h29: a alteração de horário
ou serviços feita pela equipe atualiza imediatamente o mesmo agendamento,
reserva o destino e libera a origem. Cliente com conta recebe pedido de resposta
com os termos congelados. Aceitar registra a concordância sem mover ou cobrar
novamente. Recusar avisa a equipe e sinaliza a reserva, mantendo o novo horário
protegido até ajuste ou cancelamento explícito; não restaura o horário antigo
(nem cancela automaticamente). Solicitações criadas antes desta versão conservam
a regra original de mover somente no aceite. Cliente sem conta criado pela equipe
segue no fluxo direto e deve ser contatado pela equipe. Nenhum WhatsApp/SMS automático é
adicionado.

## Preço por dia e janela pública

- o dono/gerente pode criar um acréscimo percentual ou fixo por dia da semana;
- uma data específica, como feriado, substitui a regra do dia da semana para
  evitar somar dois acréscimos;
- preço, duração e serviços são recalculados no servidor e congelados no
  snapshot do atendimento;
- o calendário público oferece no máximo 60 dias de antecedência, ainda que
  um valor legado do salão seja maior.

## Unidades e múltiplos serviços

Entram no desenho de domínio desde agora:

- estabelecimento (`tenant`) pode ter várias unidades;
- profissionais e agendamentos pertencem a uma unidade;
- um agendamento pode conter vários serviços ordenados;
- duração e preço totais são snapshots calculados no servidor;
- cada serviço preserva duração, preço e profissional aplicados na data;
- migrations devem preservar os atuais `serviceId`, `priceCents` e relações.

## Tempo

O fuso segue o estabelecimento, configurado como timezone IANA, por exemplo
`America/Sao_Paulo`. Instantes são armazenados em UTC; datas/horas civis são
interpretadas no timezone do estabelecimento no servidor. Agenda, dashboard,
cliente, histórico e notificações usam as mesmas funções centrais. Ajustes
manuais como “tirar três horas” são proibidos.

Para redes com unidades em fusos diferentes, a unidade poderá sobrescrever o
timezone do estabelecimento; enquanto isso não existir, herda o do tenant.

Estados que afirmam presença ou execução (`IN_PROGRESS` e `COMPLETED`) e o
recebimento pela comanda não podem ser antecipados para antes de `startAt`.
Essa regra é de domínio no servidor; esconder a ação na interface é apenas uma
representação adicional, nunca a autorização.

## Cliente convidado e conta

Pedido de 12/09/2026: telefone válido com DDD é obrigatório no cadastro público.
Contas antigas sem telefone recebem alerta para preenchimento no aplicativo;
o acesso é preservado e o número atualizado fica disponível ao estabelecimento.
Isso não autoriza vincular/mesclar automaticamente perfis pelo telefone.

Atualização autorizada na solicitação de evolução de produto de 06/09/2026:
o catálogo público pode ser consultado antes do login. Criar reserva, entrar
na fila e consultar dados pessoais continuam exigindo sessão do estabelecimento
validada no servidor. Esta decisão não autoriza reservas anônimas.

Não unir cadastros automaticamente apenas pelo telefone digitado, pois números
podem ser compartilhados, reciclados ou informados incorretamente.

Decisão recomendada:

- convidado permanece um perfil do estabelecimento para cadastros e reservas
  criados manualmente pela equipe;
- o autoatendimento público (agendamento e fila) exige conta e sessão assinada
  do mesmo estabelecimento; esconder a opção na UI não substitui o bloqueio
  da API;
- ao criar conta, o vínculo ocorre somente após confirmar e-mail ou telefone;
- possíveis duplicatas entram em revisão/mesclagem auditável;
- nunca mover histórico entre tenants;
- uma mesclagem preserva IDs anteriores e registra responsável/correlação.

## Recuperação de senha por e-mail

Decisão autorizada pelo responsável em 30/08/2026:

- proprietário, equipe e cliente com conta podem solicitar recuperação por e-mail;
- a resposta nunca confirma se a conta existe;
- o token aleatório é persistido somente como SHA-256, expira em 1 hora e é
  apagado após uso ou falha de entrega;
- cada solicitação substitui o token anterior; a troca incrementa a versão da
  sessão e exige novo login nos dispositivos;
- cliente é sempre resolvido por `salonSlug` e atualizado dentro de
  `withSalonBySlug`, sem procurar perfil fora do tenant;
- a entrega usa a abstração Resend existente e só fica disponível com
  `RESEND_API_KEY` e `EMAIL_FROM` configurados;
- a migration manual aditiva `017_password_recovery` deve passar em banco
  descartável e homologação antes de qualquer promoção do código.

## Status-base

Modelo alvo:

- `scheduled`
- `confirmed`
- `checked_in`
- `in_progress`
- `completed`
- `cancelled_by_client`
- `cancelled_by_business`
- `no_show`

“Remarcado” será um evento, não um status terminal. A migration a partir dos
status atuais terá mapeamento explícito, contagem antes/depois e rollback.

Na Fase 2 foi mantido o enum legado compatível
`PENDING/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED/NO_SHOW`. A distinção entre
cancelamento do cliente e do estabelecimento está preservada em metadados de
ator e evento; “remarcado” já é evento imutável. `checked_in` e a expansão do
enum ficam para uma migration própria, sem reescrever o histórico existente.

## Bloqueios — complemento de 12/09/2026

Dono/gerente podem criar e editar bloqueios fora do expediente, inclusive até
00:00 do dia seguinte. O motivo do bloqueio é opcional. Alterar um bloqueio
mantém seu ID, registra antes/depois e preserva reservas e outras ocorrências.
Cancelamento de reserva continua separado; o motivo é opcional desde 03/10/2026.

## Secretária de Agenda — decisões do dono de 29/09/2026 (Candidata 4)

Decididas em conversa. São regras gerais do produto, não regras por frase. A redação é abstrata de propósito: nenhum exemplo reproduz frases de conjuntos de prova.

1. **Criação ou consulta de disponibilidade sem dia dito:** a Secretária pergunta o dia. Não assume o dia corrente.
2. **Remarcação que muda só o dia, sem pedir para manter o horário:** a Secretária pergunta o horário (decisão da Golden GF14). Com pedido explícito para manter, usa o horário atual.
3. **Bloqueio com início e sem fim:** a Secretária pergunta o horário final. Não estende sozinha até o fim do expediente (resolve a pendência do OM04).
4. **Pedido para cancelar e remarcar a mesma cliente:** é uma única remarcação, que mantém o agendamento e o histórico. Não é cancelamento mais agendamento novo, e o motivo de cancelamento não é pedido.
5. **Referência em primeira pessoa à agenda:** vale a agenda profissional do próprio usuário, quando ele estiver vinculado a um cadastro de profissional. Sem esse vínculo, a Secretária pergunta de quem é a agenda. O simulador de testes ainda não vincula o dono a um profissional.
6. **Consulta do próximo atendimento de um profissional sem dia, quando não há mais atendimentos no dia corrente:** a Secretária olha o próximo dia de trabalho dele.
7. **Pronome depois de mover uma cliente e ocupar o horário liberado com outra, no mesmo pedido:** o pronome sem outra pista se refere à cliente movida, que é o tópico do pedido.
8. **Bloqueio "entre dois horários" que acabaram de ser definidos no mesmo pedido:** bloqueia só o intervalo livre entre os atendimentos, sem sobrepor nenhum deles.
9. **Combos:** o catálogo de cada salão decide.
   - Se existe um serviço cadastrado cujo nome corresponde à combinação pedida, a Secretária usa esse serviço.
   - Se só existem os serviços separados, ela agenda vários serviços no mesmo atendimento.
   - Se existem os dois cadastros, ela pergunta qual usar.
   - Para tirar um componente de um atendimento feito com combo, ela propõe trocar para o serviço restante, se ele estiver cadastrado. Se não estiver, ela explica e pergunta.
   - As provas cobrem salões com combos e salões com serviços separados.

## Secretária de Agenda — decisões do dono de 30/09/2026 (Candidata 5)

10. **Bloqueio com atendimento dentro do intervalo:** a Secretária nunca propõe o bloqueio direto. Ela mostra os atendimentos e pergunta, com opções reais: bloquear só o horário livre ou o período todo, mantendo os agendamentos marcados.
11. **Acrescentar um combo a um atendimento que já tem uma das partes dele:** o combo substitui essa parte; o atendimento nunca fica com o combo e a parte juntos. Um combo com uma parte que o dono não disse e que o atendimento não tem só entra com a escolha do dono.
12. **Conferente** (checagem da proposta contra o pedido): quando ele falha ou estoura o tempo, a proposta aparece como antes, e o Confirmar continua obrigatório.

## Secretária de Agenda — arquitetura e critérios delegados pelo dono (30/09/2026)

O dono aprovou a migração para "a LLM conduz a conversa e escolhe as consultas → as ferramentas retornam dados reais → a LLM propõe a ação → o backend valida e executa com segurança" e delegou as escolhas abaixo ("o que for melhor para o usuário e para nós"). São critérios de produto, ajustáveis no prompt, não regras por frase.

13. **Contexto:** híbrido. A Luna escolhe as consultas; junto com a equipe, os serviços e a data de hoje, o backend pode entregar pré-carregada a agenda dos dias que a mensagem cita, se a medição mostrar que isso reduz tempo e custo sem perder acerto. Adoção decidida por A/B.
14. **Risco:** ação de baixo risco e reversível (marcar, remarcar, trocar serviço) → a Secretária propõe a leitura mais provável e mostra a suposição; ação de alto risco (cancelar, bloquear por cima de cliente, mexer em vários clientes de uma vez) → pergunta. Meta: no máximo 10% dos pedidos parados em pergunta.
15. **"Com quem tiver":** escolhe quem faz o serviço e está livre no horário; no empate, quem tem menos atendimentos no dia. A proposta diz quem foi escolhido.
16. **Exceção dita** ("menos o horário da X", "só o vazio"): bloqueia só o horário livre, sem o cartão da regra 10, e mostra isso na proposta. Sem exceção dita, a regra 10 continua.
17. **"Até fechar":** vale como fim do expediente daquele profissional naquele dia, mostrado na proposta.
18. **Horas soltas de 8 a 11:** quando o salão ou o profissional atende nas duas leituras (manhã e noite), a Secretária pergunta; quando só uma é possível, usa essa e mostra a suposição.
19. **Operação:** modelo `gpt-6-luna`, nível de serviço Standard em produção (sem Flex nem Fast), esforço de raciocínio decidido por medição, timeout atual mantido até a medição com cache; nenhum outro modelo sem nova autorização do dono.
20. **Critérios de tempo e custo do agente (pré-registrados antes da medição):** p50 ≤ 8 s e p90 ≤ 15 s por mensagem; custo por mensagem ≤ 2× o da C4 medido na mesma rodada; timeouts ≤ os da C4 + 2. Acerto e segurança continuam decidindo primeiro.
21. **"Confirmar tudo":** um lote com cancelamento, bloqueio ou mais de uma cliente mostra antes um resumo de revisão, com o texto do backend, e o dono confirma o lote de uma vez.
22. **Privacidade do agente:** a Luna só vê os nomes de clientes que o dono escreveu (máscara por palavra); os outros dados da agenda vão sem nome e sem guardar nada na OpenAI (`store:false`).
23. **Reserva:** o agente pode cair para o caminho da C4 em no máximo 15% das mensagens; acima disso, não é adotado.

## Secretária de Agenda — decisão do dono de 01/10/2026

24. **Tempo da primeira chamada do agente:** a primeira chamada à Luna pode durar até 25 s; as rodadas seguintes de consulta continuam com até 15 s, e a mensagem inteira continua limitada a 45 s. Motivo medido no S2: com 15 s, pedidos com 3–4 ações estouravam o prazo e caíam para a C4, levando 20–28 s no total. A regra 20 (p50 ≤ 8 s, p90 ≤ 15 s) continua valendo.

## Secretária de Agenda — piloto da remarcação (decisões do dono, 02/10/2026, 03:48)

Princípio do piloto: **a Luna interpreta a linguagem; o código depois dela não reinterpreta o português.** O resolvedor determinístico só pode:
- consultar registros reais;
- resolver identidade;
- detectar ambiguidade real;
- calcular datas e horas a partir do recebido_em congelado;
- verificar disponibilidade e regras;
- localizar o atendimento uma única vez.

Ele nunca usa maiúsculas, listas de palavras, citações literais ou gramática para decidir de novo o que o dono quis dizer.

25. **Escopo inicial do piloto:** só remarcação simples de **um** atendimento existente. Pode mudar o dia, o horário, o profissional ou combinações desses três, sempre mantendo o serviço. Consultar, agendar e multi-ação ficam para depois do gate.
26. **Fora do escopo:** cancelar, bloquear, trocar serviço, combo, recorrência e multi-ação. Se um pedido for só em parte fora do escopo, a Secretária pergunta antes de propor a parte possível.
27. **Referência temporal com duas interpretações realmente plausíveis** (por exemplo, "sexta" antes ou depois do atendimento original): a Secretária pergunta. Nunca escolhe em silêncio.
28. **Tempo no piloto:** até 15 s por chamada e 45 s no total. Os 25 s da decisão 24 valem só para o Agent congelado e só voltam como experimento separado.
29. **Avaliador de desenvolvimento:** `target_professional_ref` conta como equivalente a `professional_ref` só no avaliador de desenvolvimento. Os resultados oficiais não mudam.
30. **Estado persistido:** só no banco local. A migration 027 não vai para produção.
31. **Aviso ao cliente:** a remarcação mantém a notificação normal ao cliente, e a proposta diz claramente que o cliente será avisado.

## Secretária de Agenda — DeepSeek no lugar do Luna (decisão do dono, 04/10/2026)

32. **Modelo:** a Secretária usa o **DeepSeek V4.1 Flash pelo OpenRouter** no lugar do `gpt-6-luna`, por velocidade. Isso substitui a parte de modelo da regra 19. O Luna continua disponível como volta (`SALON_SECRETARY_MODEL=gpt-6-luna`). Detalhes em `SECRETARY_DEEPSEEK_OPENROUTER.md`.
33. **Roteamento:** o servidor **Together** fica fixo, sem reserva: foi o mais rápido medido (1,5–1,6 s por turno) e tem retenção zero de dados (decisão do dono, 04/10, depois da medição; a primeira escolha tinha sido a rota padrão). Raciocínio desligado e `temperature: 0` (decisão do dono, 04/10: menos variação entre respostas). `SALON_SECRETARY_OPENROUTER_PROVIDER=any` volta para a rota padrão.
34. **Transcrição:** continua na OpenAI (`gpt-4o-mini-transcribe`), com os tetos de 03/10.
35. **Validação:** teto de US$ 2 de gasto real no OpenRouter para medir tempo e acerto (teste de latência e Golden 30). O teto de reservas da missão Golden do DeepSeek (pior caso, não gasto) subiu para US$ 6 e depois para US$ 10, aprovado pelo dono em 04/10 porque o gasto real é de centavos.
36. **Escopo:** só o caminho C4 usa o DeepSeek. O agente C5 e o piloto da remarcação continuam exigindo a OpenAI e são recusados com o DeepSeek.
37. **Arquitetura de modelos (04/10):** trocar de LLM é configuração e prova. Cada modelo tem uma ficha no cadastro; fora do desenvolvimento local e dos testes, só responde o modelo com certificado da Golden 30 (pelo menos 3 rodadas, todos os casos certos, sem falha de segurança) para o contrato atual. Os gastos de avaliação ficam separados por carteira (OpenAI e OpenRouter), e o OpenRouter é cobrado pelo custo real. Detalhes em `SECRETARY_MODEL_ARCHITECTURE.md`.
38. **Plano B automático (04/10):** quando o provedor do modelo principal falha (erro do provedor, conexão ou tempo), um modelo reserva de outro provedor responde o mesmo pedido; depois de 2 falhas seguidas, o reserva atende direto por 60 s. Na demo o reserva é o GPT-6 Luna. Fora do desenvolvimento local, o reserva também precisa de certificado da Golden.
39. **Teto da OpenAI (04/10):** o teto de gasto real de avaliação na OpenAI subiu de US$ 15 para US$ 16 (+US$ 1), aprovado pelo dono para certificar o GPT-6 Luna como reserva do plano B. A certificação não passou (falha de segurança no GF07 da 3ª rodada); ver `SECRETARY_MODEL_ARCHITECTURE.md`.
40. **Nome de serviço que já existe (04/10):** pedir para cadastrar um serviço com o nome de um que o salão já tem vira a **alteração** desse serviço: o preço e a duração ditos viram a mudança, com confirmação, nunca um serviço duplicado. O nome é comparado sem diferenciar maiúsculas, acentos e artigo inicial; um nome parecido ("Escova Lisa Longa" ao lado de "Escova Lisa") continua sendo serviço novo. Vale para qualquer modelo (`src/lib/secretary-existing-service.ts`).
41. **Reserva do plano B (04/10):** o DeepSeek continua o modelo principal. O GPT-6 Luna fica só como reserva de emergência, para responder quando o OpenRouter cair, e precisa de certificado como o principal. Depois da trava do item 40, os dois passam de novo pela Golden 3 vezes.
42. **Janela de decisão no chat (05/10):** toda escolha que a Secretária espera (qual cliente, qual agendamento, qual serviço, manhã ou noite, um horário oferecido) abre numa janela por cima da conversa, uma por vez ("Decisão 1 de 2"), com o pedido em destaque e as opções em botões; respondida, a próxima aparece sozinha. Fechada ("Decidir depois" ou Esc), uma barra acima da caixa de mensagem mostra as pendências e reabre a janela. "Responder por mensagem" continua disponível. A janela nunca confirma nada (`secretary-chat.tsx`). Próxima etapa sugerida: confirmação em janela e chat mais limpo.
43. **Manhã ou noite numa remarcação (05/10):** quando ainda não se sabe qual agendamento será remarcado (a cliente tem mais de um), o horário dito é checado contra todos os agendamentos possíveis daquela cliente: se nenhum profissional deles atende no horário da noite, vale o da manhã e a Secretária diz isso; se algum atende, continua perguntando. Depois que o agendamento é escolhido, a checagem é refeita com ele (`scheduling-daypart-facts.ts`). Complementa a decisão 18 de 30/09.
44. **Regra da reserva do plano B (05/10, opção b):** um modelo reserva é certificado com zero falhas de segurança e pelo menos 98% dos casos da Golden certos nas 3 rodadas (tudo executado), porque só responde quando o provedor do principal cai. O certificado de reserva nunca libera o modelo como principal. O GPT-6 Luna foi certificado como reserva com 89 de 90 (`golden-20261005-luna-reserve-k3`, sem falha de segurança).
45. **Fluxo por voz na janela (05/10, flag `SALON_SECRETARY_FLOW_WINDOW`):** além das escolhas, a janela leva a pergunta aberta ("Para quando passo o Sérgio?") e depois a confirmação (resumo antes → depois, Confirmar). Numa conversa conduzida por voz, o microfone reabre sozinho a cada passo e a fala vai sozinha após 2 s de silêncio; sem fala em 15 s, o microfone fecha sem gastar. **Voz confirma, com proteção** (muda a regra de 03/10 "nada é confirmado por voz"): só uma palavra clara de confirmação ("confirma", "pode confirmar") confirma, a tela mostra o que ouviu e conta 3 s com Cancelar, e só com uma ação a confirmar; "cancela"/"não" nunca confirma, um "sim" sozinho não basta, qualquer outra fala vai como correção. Na demo a flag vem ligada; em produção, depende de ligar a variável.
46. **Exceções de agenda pela Secretária (05/10, flag `SALON_SECRETARY_SCHEDULE_EXCEPTIONS`, depende da de encaixe):** igual à agenda, para agendar e remarcar. Fora do expediente/folga e intervalo: dono, gerente e o próprio profissional; horário bloqueado, terminar depois do expediente e sobreposição: dono e gerente. Antes de propor, a Secretária pergunta "Esse horário fica fora do expediente de Otávio Lins. Quer agendar mesmo assim ou escolher outro horário?" com o botão "Agendar/Remarcar mesmo assim" (ou a resposta "pode agendar mesmo assim", lida sem o modelo; "não" recusa; "sim" sozinho só vale quando a pergunta é da única ação). **Motivo opcional** (o dito pelo dono, ou "Exceção confirmada pela Secretária"); o cartão mostra "EXCEÇÃO: … · Motivo: …" e o Confirmar continua obrigatório. Salão fechado, horário passado, sala/equipamento e oferta da fila continuam sempre recusados. Na execução o perfil e as causas são conferidos de novo (mudou → nada é gravado) e fica registro de auditoria (`SECRETARY_SCHEDULE_EXCEPTION_CREATE/RESCHEDULE`). Encaixe puro num agendamento novo segue o fluxo antigo (motivo obrigatório) para não mexer no que está certificado. Contrato do modelo inalterado.
47. **Troca e marcação de serviço (05/10, flag `SALON_SECRETARY_SERVICE_SWAP_V2`):** "Troque o serviço da Isabela do dia 17 para pedicure" pedia "data original e data" porque a regra "do [origem] para [destino]" lia "para pedicure" como destino e retirava o "dia 17" que o modelo leu. Agora "para" só é destino quando vem um dia ou horário depois ("para o dia 20 às 11h", "pra terça", "pras 15h"); a troca vira ALTERAR no mesmo horário. E o serviço com o nome exato dito ganha sem perguntar ("pedicure" → "Pedicure", nunca "Manicure + Pedicure"), no agendar e no trocar; "troca a manicure por pedicure" não pergunta mais "pacote ou separado". Provado no fluxo real (banco local + DeepSeek) com as frases do dono.
48. **Nomes parecidos por voz ou grafia (05/10, dono aprovou as 4 melhorias):** (1) busca pelo som (`SALON_SECRETARY_PHONETIC_NAMES`): W/V, Y/I, letra dobrada, PH/F, TH/T, K/C/QU, H mudo, Z/S, GE/JE, CE/SE; quando só uma cliente ou serviço soa exatamente igual ao dito, a Secretária segue com ele (o nome completo aparece no cartão antes do Confirmar); havendo mais de um, mostra as opções; nunca para um nome que o modelo escreveu diferente da mensagem. (2) O filtro das duas primeiras letras das sugestões de cliente também tenta os começos do mesmo som ("Wa" acha "Va", "Ti" acha "Th"). (3) Memória da escolha (`SALON_SECRETARY_NAME_ALIASES`, já existente) ligada na demo. (4) A transcrição de voz recebe também os nomes das clientes com agendamento de 7 dias atrás a 30 à frente, até 40 nomes, só o nome (`SALON_SECRETARY_TRANSCRIBE_CUSTOMER_NAMES`; decisão do dono: os nomes vão à OpenAI junto com o áudio). Provado no fluxo real: Walter → Valter Assunção, Isabella → Isabela Mattos, Tiago → Thiago Mendes.
49. **Piloto da Secretária em Produção (05/10):** só para o **dono** do salão de apresentação (`everflair-apresentacao`), teto de **US$ 1 por dia** (chamadas de modelo + voz), todas as funções certificadas (memória da escolha fica desligada). Flag `SALON_SECRETARY_PRODUCTION_PILOT` + lista exata `SALON_SECRETARY_ALLOWED_ACTORS`; qualquer outro salão ou usuário é recusado. Certificação com as flags novas: DeepSeek 90/90 (principal) e Luna 90/90 (reserva). Passos e variáveis: `docs/SECRETARY_PRODUCTION_PILOT.md`. Também: na regra de manhã/noite, quando nenhuma leitura está livre mas o motivo vira exceção, vale a do horário de funcionamento do salão e segue para "quer marcar mesmo assim?"; serviço não reconhecido pela voz vira sugestão pelos mais parecidos na escrita.

## Verde de volta — 06/10/2026

O lilás nos botões e a borda animada (PR #129, mesclado em 06/10) foram
desfeitos a pedido do dono: painel e app do cliente voltam aos botões
principais verdes, com lilás restrito à marca e à seleção. Não reaplicar
sem conferência visual aprovada pelo dono.

## Tela de início do cliente anterior — 06/10/2026

A pedido do dono, a tela de início do cliente volta à versão anterior ao #131
(sem a faixa "Nossa equipe" em retratos, as abas fixas e os serviços agrupados
em categorias recolhidas). Os lembretes em Notificações ("EverFlair lembra
você") deixam o roxo e usam o verde principal, como as demais notificações.
