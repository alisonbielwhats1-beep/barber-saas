# Contratação, notificações e HQ — 13/09/2026

Continuação autorizada do PR #101: conectar a escolha/gestão da assinatura,
homologar o webhook externo e alimentar automaticamente HQ, CRM e CMM após
confirmação financeira. Base: backend 1c014f0, CI 34733943942 aprovado.

## Fluxo e limites

- Catálogo único mensal/anual; escolha acompanha cadastro/login/criação do
  estabelecimento. Cadastro existente continua gratuito e aprovado conforme
  as regras atuais; suspensão administrativa permanece independente.
- Proprietário confirma contratação no portal, paga no Mercado Pago e acompanha
  confirmação, período pago, próxima cobrança, histórico e cancelamento.
  Retorno do checkout nunca aprova pagamentos. Valores vêm do servidor.
- Aviso nativo no celular depende do Mercado Pago e das permissões de notificação
  da conta/dispositivo. Não há promessa de texto personalizado nem envio de WhatsApp.
- Integração HQ identifica estabelecimento, contrato e cobrança por vínculos
  únicos. Não mescla cadastros por nome, telefone ou e-mail. Dados sincronizados
  de cobrança não podem ser sobrescritos pelas ações manuais do HQ.
- Receita recebida considera pagamentos confirmados; MRR normaliza anual por
  doze meses. Cancelamento interrompe recorrência e preserva período/histórico.
- Migration aditiva e RLS para os vínculos; testes somente em PostgreSQL fictício.
  Flags e migration produtivas continuam sem ativação/aplicação.

## Homologação externa

Os dois projetos Supabase disponíveis estão reservados para produção, conforme
`AMBIENTES.md`; nenhum deles é staging.
Preparar banco local sintético com runtime sem BYPASSRLS e endereço HTTPS
temporário limitado ao webhook. Usar aplicação/contas/cartões fictícios e
assinatura original enviada pelo Mercado Pago. Preservar configuração anterior
e encerrar assinaturas e endpoint ao concluir. Esse teste não cria staging
persistente nem autoriza alterações na produção.

## Verificação

Validar jornada de contratação e cancelamento, autorização, estados da tela,
replays/concorrência, atualização de CRM/CMM/financeiro, RLS e preservação.
Executar lint, TypeScript, testes, build, CI/schema-smoke e Preview.
Registrar aqui e no PR somente resultados efetivamente obtidos.

## Resultado local em 13/09

- `npm run lint` e `npx tsc --noEmit --incremental false`: passaram.
- `npm test`: 930 testes em 184 arquivos passaram.
- `npx vitest run src/lib/billing/billing-postgres.integration.test.ts src/lib/hq/hq-postgres.integration.test.ts`
  com `RUN_POSTGRES_INTEGRATION=1`: 27 testes passaram no PostgreSQL 16, com
  migration HQ 020 real e runtime sem BYPASSRLS. Inclui concorrência, replays,
  RLS entre estabelecimentos, bloqueio de alteração financeira manual,
  renovação, falha/recuperação, anual, cancelamento e estorno parcial/total.
- `npm run build`: passou, incluindo contratação habilitada somente no build
  local de teste. Home é estática; mudança da flag exige novo build/deploy.
- Navegador local: catálogo mensal/anual e links preservando a escolha;
  cadastro mostrando Equipe Plus anual R$ 958,80; login e portal do proprietário
  com pagamento, cinco agendas e acesso preservado após cancelamento. Em 390px,
  o portal não apresentou overflow horizontal. CRM, CMM, ficha e assinatura no
  HQ mostraram o mesmo cliente/valor/período do pagamento fictício confirmado.
  Cadastro e dados locais usados nessa inspeção são inteiramente sintéticos.
- Revisão corrigiu a edição de acompanhamento do cliente vinculado: campos
  financeiros desabilitados são recompostos a partir do banco antes da validação,
  mantendo alterações de contato/satisfação e rejeitando alterações financeiras.
  O teste cobre campos omitidos e valores financeiros forjados.
- Migration 024: preflight, aplicação, reaplicação, verify e inventário de
  rollback executados no banco sintético. Backup prévio foi restaurado em
  segundo banco e comparado por fingerprint. CI ampliado repete preservação
  dos dados anteriores, restauração e os testes HQ após 024.

O simulador oficial da aplicação **fictícia** 1966622971462001 enviou em
`2026-09-13T03:59:07.531Z` a notificação `subscription_preapproval` referente
à assinatura de teste `366da5bcf6a54a3a853d24d9e9c7590e` (request ID
`4b668800-d87e-43a1-8084-6562f5d34e69`). O ingresso HTTPS recebeu a assinatura
original e respondeu **200**. A API autenticada confirmou o contrato; o worker
projetou no HQ o cliente, Equipe Plus mensal R$ 99,90, cinco agendas, período pago
até `2026-10-13T00:51:57Z` e a cobrança aprovada já existente. Requisição sem
assinatura foi recusada com 401; outras rotas públicas do ingresso retornaram 404.

Isso comprova transporte externo/HMAC/consulta/projeção. Não comprova entrega
espontânea de um novo pagamento: o checkout do comprador fictício apresentou
R$ 99,90 mensais, mas manteve a confirmação desabilitada. A nova assinatura
`020feb59b05244be976b5bf61301e1b7` foi cancelada ainda pendente, confirmado no
provedor em `2026-09-13T04:14:10.696Z`, sem período pago. Os dois URLs temporários
foram removidos com a opção Redefinir da aplicação fictícia, e túnel/proxy foram
encerrados. A aplicação principal 5276100300886 não foi alterada. Nenhum segredo
foi versionado. A notificação nativa no celular não foi validada neste teste.

## Nova verificação de 13/09 — ambiente e evento espontâneo

Codespace de demonstração identificado e iniciado: `glorious-enigma-jjv6v4rvrv49f544r`,
branch `codex/everflair-demo`, commit `106ac11`, sem alterações no checkout.
Consulta somente leitura confirmou `everflair_demo`, host `127.0.0.1:5432`,
role `app_runtime` sem superusuário/BYPASSRLS. A porta 3000 está **Private**;
a abertura da aplicação pelo navegador retornou 401. Não foram alterados schema,
dados, versão ou visibilidade. Detalhes em `AMBIENTES.md`. O PR #101 ainda não
está implantado nesse ambiente e o encaminhamento privado não recebe webhooks
externos sem autenticação do GitHub.

Uma segunda tentativa local criou a assinatura fictícia mensal Equipe Plus
`4c2d1646473e4a9ea8d91dfc89109c46`, R$ 99,90, entre o vendedor `3683184919` e o
comprador `3683184927`. A revisão do checkout continuou com Confirmar
desabilitado após preenchimento do cartão oficial de teste. Nenhum novo
pagamento foi aprovado. Cancelamento confirmado no provedor em
`2026-09-13T05:10:36.896Z`, sem período pago.

Esse cancelamento gerou uma notificação **espontânea**, sem simulador:
`subscription_preapproval`, request ID `9a3ba333-32e9-47cf-85c1-d6f2a1800bbe`,
recebida em `2026-09-13T05:10:38.895Z`, com HMAC válido e HTTP **200**.
Inbox processada em `2026-09-13T05:12:55.939Z`, sem erro na fila, após execução
do reconciliador. Isso comprova entrega espontânea e processamento de um evento
de assinatura; **não** comprova aprovação de nova cobrança nem atualização de
receita decorrente dela. A homologação de novo pagamento segue pendente.

Ao terminar, os URLs de teste e produção da aplicação **fictícia** foram
removidos por Redefinir e os tópicos ficaram desmarcados. Túnel, proxy, servidor
Next local e cluster local foram encerrados; nenhuma porta 3067/3068/55487
permaneceu ouvindo. A aplicação principal não foi alterada. O CI do código
`c4767db` (run `34738007836`) ainda estava em fila, sem resultado; esta revisão
posterior altera somente documentação e passou em `git diff --check`.

O responsável informou que o iPhone usa sua conta **oficial** do Mercado Pago.
O pagamento entre contas fictícias não comprova push nessa conta. A conferência
das permissões e da chegada do aviso no aparelho depende do responsável;
nenhuma notificação no celular foi observada pelo agente.

## Liberação e operação

1. Manter contratação, `MERCADOPAGO_HQ_SYNC_ENABLED` e cron desativados em
   Production até revisão/CI/Preview e autorização de promoção.
2. Identificar staging persistente, credenciais e role; fazer backup com
   restauração comprovada, conferir predecessores e aplicar 023/024 somente
   com autorização adequada. Não reaplicar 020 ou migrations anteriores.
3. Habilitar HQ sync apenas onde 024 está verificada. Billing é a fonte dos
   valores/estados; HQ permite editar contatos e acompanhamento, sem alteração
   manual de cobranças gerenciadas pelo Mercado Pago. A projeção é limitada,
   idempotente e reprocessada pela fila após falhas.
4. Configurar webhook e reconciliador duráveis. Validar uma transação fictícia
   nova com entrega espontânea antes da liberação aos clientes. O teste de
   simulador acima não substitui esse cenário nem um staging persistente.
5. Conferir permissões de notificações no aplicativo do Mercado Pago do recebedor.
   O Everflair não controla a entrega/texto do push nativo. Não há novo serviço
   pago nem envio de WhatsApp/SMS nesta entrega.

Rollback de 024 é operacional: desabilitar somente HQ sync para interromper
novas projeções, preservando dados. Manter webhooks, reconciliador e cancelamento
do billing enquanto houver contratos ativos; desligar código não cancela
assinaturas no provedor. Nunca apagar histórico financeiro para reprocessar.
