# PRD — Everflair

**Versão:** 24/09/2026 · **Base:** `origin/master` `27255eb` · **Estado:** síntese do produto atual e de decisões registradas, sem nova autorização de implementação.

## Problema e resultado

Estabelecimentos de beleza e bem-estar precisam publicar sua oferta, receber reservas confiáveis, operar a agenda de uma equipe, registrar recebimentos e manter o relacionamento com clientes sem perder histórico. Clientes precisam entender preço, duração e disponibilidade, confirmar uma visita e gerenciar as próprias reservas no celular. O Everflair reúne essas jornadas em um SaaS por estabelecimento (`Salon`).

O resultado principal é uma reserva correta e rastreável, do catálogo ao atendimento e ao recebimento. A assinatura paga pelo estabelecimento ao Everflair é outro fluxo financeiro e não pode ser confundida com o pagamento do cliente pelo serviço.

## Pessoas e contextos

| Pessoa | Necessidade | Superfície |
| --- | --- | --- |
| Cliente | Descobrir, reservar, acompanhar, remarcar/cancelar e avaliar | `/book/[salonSlug]` |
| Proprietário | Configurar salão, acompanhar operação e assinatura | `/dashboard`, `/agenda`, `/configuracoes`, `/assinatura` |
| Gerente | Operar equipe, disponibilidade, exceções e financeiro autorizado | Painel do salão |
| Recepção | Registrar atendimentos e recebimentos sem relatórios comerciais amplos | Painel do salão |
| Profissional | Ver e operar a própria agenda e os próprios clientes | Painel restrito |
| Administração global/HQ | Governar acesso, cobrança e suporte da plataforma | `/plataforma` e `/hq` |

## Requisitos funcionais

| ID | Requisito verificável | Fonte |
| --- | --- | --- |
| P-01 | Salão tem catálogo, equipe, jornadas, folgas, bloqueios, fuso IANA, política de reserva e link próprio; onboarding orienta a configuração inicial. | `STATUS_ATUAL.md`, `CONFIGURACAO_INICIAL_2026-09-13.md` |
| P-02 | Catálogo e horários são consultáveis sem login. Confirmar reserva, entrar em fila e ver dados pessoais exige sessão válida do cliente no salão correto; cadastro público exige telefone com DDD. | `DECISOES_PRODUTO.md` |
| P-03 | Visita admite até dez serviços, inclusive repetidos, com profissional por item. Uma confirmação grava todos os atendimentos ou nenhum; sequência é padrão e simultaneidade pública exige combinação habilitada. | `VISITAS_MULTIPROFISSIONAIS_2026-09-13.md` |
| P-04 | Preço, duração e disponibilidade são recalculados no servidor. Reserva usa idempotência, transação e proteção de conflito; cliente revisa termos antes de confirmar. | `STATUS_ATUAL.md` |
| P-05 | Equipe gerencia agenda, chegada, status, bloqueios, fila e exceções autorizadas com motivo/auditoria. Profissional não ganha acesso à agenda alheia. | `DECISOES_PRODUTO.md` |
| P-06 | Cliente vê próxima reserva, histórico e notificações. Remarcação preserva ID e cancelamento preserva registro. Edição imediata da equipe ocupa destino antes da resposta; recusa exige tratamento humano. | `DECISOES_PRODUTO.md` |
| P-07 | Financeiro distingue previsto, realizado e recebido. `Payment` registra recebimento do cliente com método e ajustes, sem reescrever preço reservado. | `RECEBIMENTOS_E_AGENDAMENTO_2026-09-13.md` |
| P-08 | Assinatura SaaS usa Mercado Pago. Checkout não concede acesso; confirmação financeira no servidor libera período. Cancelamento impede renovação e preserva período pago. | `STATUS_ATUAL.md` 20/09 |
| P-09 | Avaliações vêm de atendimento concluído. Marketing e contato por WhatsApp dependem de ação humana. Exclusão da lista de clientes preserva conta e histórico. | `DECISOES_PRODUTO.md` |
| P-10 | Suporte/HQ e administração global têm permissões próprias; ações sensíveis de agentes do HQ exigem revisão humana. | `HQ_AGENTES_ARQUITETURA.md` |

## Requisitos de qualidade

- **Isolamento:** nenhum usuário lê ou altera dados de outro salão por UI, API, job ou upload. Papel e propriedade são validados no servidor e reforçados por RLS.
- **Confiabilidade:** duas solicitações para a mesma vaga não geram sobreposição acidental. Reenvio idempotente não duplica reserva, cobrança, baixa ou notificação.
- **Rastreabilidade:** cancelamentos, remarcações, exceções, assinaturas e recebimentos preservam registros e eventos originais.
- **Tempo e dinheiro:** instantes em UTC e apresentação no fuso do salão; valores em centavos e snapshots na contratação.
- **Usabilidade:** fluxo móvel completo em 320–390 px, CTA visível com teclado/área segura, estados vazios/erro/carregamento claros e cor nunca como único indicador de status.
- **Ambiente:** desenvolvimento e CI usam dados sintéticos; Production não é ambiente de teste.

## Critérios de aceite de ponta a ponta

1. Dois clientes disputam a última vaga: no máximo uma reserva é confirmada e a outra recebe resposta recuperável.
2. Cliente de um salão tenta acessar reserva de outro: leitura e escrita são negadas no servidor e pela RLS.
3. Visita com vários profissionais falha em qualquer item ou produto: nenhuma reserva, movimento ou vínculo parcial persiste.
4. Cancelamento dentro da política libera horário, preservando reserva, ator, motivo e eventos.
5. Retorno do checkout sem pagamento não libera plano. Pagamento confirmado uma vez ativa exatamente um período.
6. Cancelar renovação encerra recorrências no provedor, preserva histórico e mantém acesso até o instante final pago.
7. Recuperação voluntária de e-mail legado altera credencial somente após concluir o link; IDs, reservas e permissões permanecem.

## Fora do escopo

Este PRD não autoriza lançar Everflair IA, ativar cobrança manual `011`, automatizar WhatsApp/SMS, criar múltiplas unidades ou transformar recibo interno em documento fiscal. Metas comerciais e indicadores numéricos ainda precisam ser definidos com o responsável; não foram inventados aqui.
