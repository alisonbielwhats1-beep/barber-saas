# Fase 1 — rollout, estado e rollback

Este documento cobre convites por e-mail, rate limiting distribuído,
endurecimento de uploads e a reconciliação do banco. Migration nunca deve ser
executada pelo build da Vercel.

## Estado em 29/07/2026

### Concluído

- PR #3 mesclado no commit `af6d063`.
- GitHub Actions e Vercel Production aprovados.
- Upstash conectado a Preview e Production por `KV_REST_API_URL` e
  `KV_REST_API_TOKEN`.
- `NEXTAUTH_URL`, banco, Supabase e `CRON_SECRET` presentes em Production.
- Bucket público `salon-assets` criado com limite de 5 MiB e MIME restrito.
- Código publicado com convites bloqueados de forma fail-closed.
- Schema de Production reconciliado e as três migrations estão aplicadas:
  - `20260728220000_fase_1_security_invites`;
  - `20260729120000_user_invite_created_by_index`;
  - `20260729164510_email_professional_invites`.
- RLS, privilégios, FKs, índices, enums e histórico Prisma validados.
- Smoke tests de Production aprovados depois da migration.

### Deliberadamente pendente

- domínio remetente no Resend;
- `RESEND_API_KEY`;
- `EMAIL_FROM`;
- `EMAIL_INVITES_ENABLED=true`;
- smoke completo de entrega e aceite por e-mail.

Sem essas três variáveis, o recurso de convite falha fechado antes de executar
ações de convite. O restante do aplicativo continua operacional.

## Registro da reconciliação do banco

O banco já possuía materialmente as duas primeiras migrations, mas não tinha
`_prisma_migrations`. Antes de registrar qualquer histórico foram comprovados:

- `User.passwordSetAt`;
- estrutura completa de `UserInvite`;
- `tokenHash VARCHAR(64)`;
- índice único do token e índice parcial por salão/e-mail normalizado;
- índices de consulta e do criador;
- FKs com regras `ON DELETE`/`ON UPDATE`;
- RLS ativa;
- ausência de DML para `anon` e `authenticated`.

Somente após a comparação, as duas migrations foram registradas com
`prisma migrate resolve --applied`. A terceira, que ainda não existia, foi
executada com `prisma migrate deploy`.

O convite legado foi preservado e marcado como
`FAILED / LEGACY_NOT_SENT`. `prisma migrate status` confirmou o banco em dia.

O snapshot lógico anterior à mudança e seu checksum estão registrados em
`docs/STATUS_ATUAL.md`. Ele não está no Git porque contém dados sensíveis.

## Drift conhecido

A comparação final ainda sugere somente:

```sql
ALTER TABLE "Appointment"
  ALTER COLUMN "reminderSentAt" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "cancelledAt" SET DATA TYPE TIMESTAMP(3);
```

Isso é anterior e fora do escopo da Fase 1. Criar migration separada após
backup e validação; não usar `prisma db push`.

## Ativação futura do e-mail

Fazer primeiro em Preview:

1. verificar o domínio remetente no Resend;
2. configurar `RESEND_API_KEY` e `EMAIL_FROM`;
3. configurar `EMAIL_INVITES_ENABLED=true`;
4. criar convite novo e confirmar entrega;
5. reenviar e provar que o token anterior foi invalidado;
6. revogar e provar que entrega atrasada não reativa o convite;
7. aceitar com conta nova e existente;
8. executar duas aceitações simultâneas e confirmar uso único;
9. conferir `UserInviteEvent` sem registrar token, hash ou dado sensível;
10. monitorar 429, 503 e falhas do provedor.

Somente depois repetir a configuração em Production. Não há migration
adicional para ativar o e-mail.

## Rollback

O rollback padrão é da aplicação/configuração:

1. remover ou definir `EMAIL_INVITES_ENABLED=false`;
2. interromper novos convites;
3. voltar o código ao deployment anterior, se necessário;
4. manter colunas, enums e `UserInviteEvent`;
5. investigar antes de reativar.

Manter a expansão do schema é o caminho mais seguro: remover colunas ou a
tabela de eventos destruiria auditoria, e não desfaria usuários, memberships
ou profissionais já ativados.

Rollback estrutural só pode ocorrer com backup nativo/ponto de restauração e
reconciliação manual. Antes de recriar o índice antigo, provar que não há dois
convites não consumidos do mesmo salão/e-mail, incluindo linhas revogadas.

## Recuperação operacional

- `FAILED`: reenviar; a nova tentativa rotaciona o token.
- `SENDING` após interrupção: usar o reenvio administrativo.
- Entrega com atualização incerta: não reutilizar token manualmente; reenviar.
- Upstash indisponível: restaurar Redis antes de liberar autenticação/escritas.
- Resend indisponível: desligar a flag; o restante do sistema continua ativo.
