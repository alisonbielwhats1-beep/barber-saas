# Decisões de produto para as próximas fases

Estas decisões consolidam as respostas do responsável pelo produto e as
recomendações técnicas adotadas. Elas orientam a implementação; não significam
que todos os itens abaixo já estão implementados na Fase 1.

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

Overbooking é manter dois atendimentos sobrepostos para o mesmo profissional.
Isso é diferente de dois profissionais atenderem no mesmo horário.

Decisão recomendada:

- desabilitado por padrão;
- conflito acidental sempre bloqueado no banco;
- encaixe deliberado está disponível apenas na criação manual para
  dono/gerente, depois de um conflito real, com confirmação, motivo e
  auditoria;
- encaixe não ignora fechamento, folga, jornada ou isolamento de tenant;
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
horário original e registra a decisão. Visitante sem conta segue no fluxo
direto e deve ser contatado pela equipe. Nenhum WhatsApp/SMS automático é
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

Não unir cadastros automaticamente apenas pelo telefone digitado, pois números
podem ser compartilhados, reciclados ou informados incorretamente.

Decisão recomendada:

- convidado permanece um perfil do estabelecimento;
- ao criar conta, o vínculo ocorre somente após confirmar e-mail ou telefone;
- possíveis duplicatas entram em revisão/mesclagem auditável;
- nunca mover histórico entre tenants;
- uma mesclagem preserva IDs anteriores e registra responsável/correlação.

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
