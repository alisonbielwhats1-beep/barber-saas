# Fase 1 — rollout e rollback

Este documento cobre o lote de convites por e-mail, rate limiting distribuído
e endurecimento de uploads. Nenhuma migration deve ser executada pelo build da
Vercel.

## Pré-condições

1. Confirmar que o histórico contém, com os nomes exatos,
   `20260728220000_fase_1_security_invites` e
   `20260729120000_user_invite_created_by_index`. Se a segunda ainda estiver
   pendente, ela deve ser aplicada nessa ordem pelo `migrate deploy`; nunca
   renomear ou marcar como aplicada sem evidência do banco.
2. Comparar as migrations locais com o histórico do ambiente.
3. Criar backup ou ponto de restauração e registrar quem fará o rollback.
4. Configurar em Preview e Production:
   - `NEXTAUTH_URL`;
   - `UPSTASH_REDIS_REST_URL`;
   - `UPSTASH_REDIS_REST_TOKEN`;
   - `SUPABASE_URL`;
   - `SUPABASE_SERVICE_ROLE_KEY`.
   Para habilitar o envio de convites por e-mail, configurar também
   `RESEND_API_KEY` e `EMAIL_FROM`. Sem essas duas variáveis o recurso deve
   permanecer fora da operação; não anunciar nem usar convites por e-mail.
   A integração nativa Upstash/Vercel pode fornecer
   `KV_REST_API_URL` e `KV_REST_API_TOKEN` no lugar das duas variáveis
   `UPSTASH_*`; o runtime aceita ambos os pares e prioriza o par `KV_*`.
5. Criar previamente o bucket público `salon-assets`. Ele contém apenas imagens
   públicas de serviços, produtos e portfólio. O backend não cria buckets em
   requisições de usuário.

## Estado da Fase 1B em 29/07/2026

- Preview: Upstash integrado à Vercel somente nesse ambiente e
  `NEXTAUTH_URL` configurado na branch `feat/email-professional-invites`.
- Production: Redis ainda não configurado para este lote.
- Resend: deliberadamente não conectado; envio por e-mail em contingência.
- Storage de Production: bucket `salon-assets` criado com limite de 5 MiB e
  allowlist de MIME.
- Banco de Production: somente leitura confirmou ausência de histórico Prisma
  reconhecido. As migrations locais aparecem pendentes e nenhuma foi aplicada.
- Organização local: somente diretórios timestampados permanecem em
  `prisma/migrations`; SQL manual e RLS ficam em `prisma/sql`.

Esse estado permite homologar o Preview, mas não autoriza merge nem publicação
em Production.

## Homologação

1. Aplicar as migrations em PostgreSQL isolado.
2. Executar os testes de integração reais:
   `npm run test:integration`.
3. Confirmar:
   - duas aceitações simultâneas geram somente um usuário, membership e
     profissional;
   - falha parcial não consome o convite;
   - reenvio invalida o token anterior;
   - cancelamento impede atualização posterior da tentativa de envio;
   - upload grava somente em `<salonId>/<finalidade>/<uuid>.<ext>`;
   - Redis ausente ou indisponível bloqueia autenticação e escritas sensíveis
     em produção.

## Ordem de produção

1. Evitar criação de convites durante a janela.
2. Executar `prisma migrate deploy` depois de conferir que a lista de pendências
   contém somente as migrations esperadas — o índice `20260729120000`, caso
   ainda pendente, seguido de `20260729164510_email_professional_invites`.
3. Validar colunas, índices, FKs, RLS e privilégios.
4. Publicar o código.
5. Fazer smoke tests de login, cadastro, convite, aceite, upload e agendamento.
6. Monitorar erros, respostas 429/503 e falhas de entrega.

A migration pode ser aplicada antes do código porque é expansiva. Entretanto,
o código anterior não registra tentativas de e-mail; por isso a janela entre
migration e deploy deve ser curta e sem criação de convites.

## Rollback

O rollback padrão é somente da aplicação:

1. interromper novos convites;
2. voltar ao commit anterior;
3. manter as colunas, enums e `UserInviteEvent` no banco;
4. invalidar convites emitidos pelo código novo se necessário;
5. investigar e corrigir antes de novo rollout.

Manter a expansão do schema é o rollback mais seguro: o código anterior ignora
as colunas novas, e removê-las destruiria histórico de entrega e auditoria.

Rollback estrutural só pode ocorrer com backup e reconciliação manual. Antes de
recriar o índice antigo, é obrigatório provar que não existem dois convites não
consumidos para o mesmo salão/e-mail, inclusive linhas revogadas. Remover
`UserInviteEvent`, enums ou colunas apaga dados e não desfaz usuários,
memberships ou profissionais já ativados.

## Recuperação operacional

- `FAILED`: reenviar; o token é rotacionado.
- `SENDING` após interrupção: usar reenvio administrativo; a nova tentativa
  invalida a anterior.
- e-mail entregue com atualização de banco incerta: não reutilizar o mesmo
  token manualmente; executar reenvio para rotacioná-lo.
- Upstash indisponível: autenticação e escritas sensíveis retornam
  indisponibilidade; restaurar Redis antes de liberar tráfego.
