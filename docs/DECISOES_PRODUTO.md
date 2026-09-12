# Decisões de produto para as próximas fases

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
- Dono/gerente podem cancelar antes do início com confirmação e motivo.
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

Para uma alteração de horário iniciada pela equipe, cliente com conta recebe
uma proposta interna com horário, profissional, serviços e preço congelados.
Aceitar atualiza o mesmo agendamento e registra o aceite; recusar mantém o
horário original e registra a decisão. Cliente sem conta criado pela equipe
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
Cancelamento de reserva continua separado, com motivo obrigatório.
