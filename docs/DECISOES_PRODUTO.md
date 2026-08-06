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
- uma configuração futura por estabelecimento pode liberar encaixe deliberado
  apenas para dono/gerente, com confirmação, motivo e auditoria;
- lista de espera é a opção preferencial;
- nunca disponível no aplicativo do cliente.

## Reagendamento

Manter o mesmo `appointment_id` e gravar um evento imutável com valores antigo
e novo. Essa opção preserva links, pagamento e referências já existentes e é a
mais segura para a arquitetura atual.

Pode trocar data, horário, profissional e serviços, desde que a operação:

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

## Estoque

Usar um livro-razão de movimentos, não apenas sobrescrever o número atual:
entrada, venda, consumo, ajuste, reserva, liberação e perda. Cada movimento
registra tenant, unidade, item, quantidade, responsável, origem e data.

- Produto vendido: baixar na confirmação da venda/checkout.
- Insumo consumido por serviço: baixar ao concluir, com possibilidade de ajuste.
- Item escasso explicitamente associado ao atendimento: pode ser reservado no
  agendamento e liberado no cancelamento.
- Bloquear estoque negativo por padrão; override exige dono/gerente e auditoria.

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
