# Fase 1 — Segurança imediata

## Convites da equipe

O proprietário cria um convite e recebe o link puro uma única vez. O banco
guarda somente SHA-256 do token.

- validade: 24 horas;
- uso único, consumido atomicamente;
- transporte atual: manual (copiar link);
- não existe envio automático de e-mail nesta fase.

### Propriedade da conta global

Conhecer o link não prova controle do e-mail e nunca autoriza definir senha.

- Conta existente: o convite guarda `email`, `salonId` e `userId`; somente o
  próprio usuário autenticado pode aceitar.
- Conta nova: nenhum `User`, `Membership` ou `Professional` é criado. O convite
  guarda o e-mail pretendido com `emailVerificationRequired = true` e permanece
  bloqueado.
- Como ainda não existe envio/verificação real de e-mail, conta nova não pode
  concluir o convite nem definir senha. O painel informa essa limitação e não
  oferece copiar o link bloqueado.

### Migration

Arquivo:

`prisma/migrations/20260728220000_fase_1_security_invites/migration.sql`

A migration cria `UserInvite`, seus índices e FKs, adiciona o estado explícito
`User.passwordSetAt`, limita a um convite pendente por usuário/salão e bloqueia
`anon`/`authenticated` via Supabase Data API. Ela foi preparada localmente e
não deve ser aplicada automaticamente por build ou deploy.

Comandos SQL adicionados para o estado explícito, unicidade e proteção da
tabela (exatamente como estão na migration):

```sql
ALTER TABLE "User"
  ADD COLUMN "passwordSetAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "UserInvite_salonId_email_pending_key"
  ON "UserInvite"("salonId", "email")
  WHERE "usedAt" IS NULL;

ALTER TABLE "UserInvite" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "UserInvite" FROM anon, authenticated;
```

Não existe policy pública para `UserInvite`. A migration também não usa
`FORCE ROW LEVEL SECURITY` e não revoga o usuário que a executa; assim, o
backend Prisma continua acessando a tabela quando usa o dono da tabela ou uma
role com `BYPASSRLS`, enquanto `anon` e `authenticated` ficam sem privilégios e
sem policy.

Aplicação futura deve ocorrer primeiro em ambiente de homologação, com backup e
janela controlada. Após aplicar, gere o Prisma Client da versão implantada.

### Contas antigas

Usuários existentes não recebem `passwordSetAt` automaticamente: fazer
backfill com base apenas na existência do `User` repetiria o problema. Um login
bem-sucedido registra esse estado de forma gradual e verificável. Convites não
alteram senha. Usuários que já receberam uma senha previsível ainda exigem
remediação controlada antes da liberação comercial:

1. rotacionar `NEXTAUTH_SECRET` em uma janela controlada para invalidar os JWTs
   administrativos existentes;
2. bloquear a senha antiga com um procedimento administrativo auditado;
3. entregar recuperação/verificação por canal comprovadamente controlado;
4. registrar `passwordSetAt` somente após a comprovação;
5. invalidar convites e sessões anteriores.

O formulário comum de convite não gera recuperação para quem já possui
membership: isso é intencional, pois um dono de outro estabelecimento não deve
conseguir redefinir a senha global de uma conta multi-tenant. A remediação das
contas legadas exige operação administrativa controlada e ainda não deve ser
executada em produção sem homologação, backup e identificação confirmada dos
usuários afetados.

Não tente detectar a senha antiga por comparação em lote, não registre hashes e
não altere `NEXTAUTH_SECRET` sem planejar o logout global.

### Rollback

O rollback estrutural é:

```sql
DROP TABLE IF EXISTS "UserInvite";
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordSetAt";
```

Isso remove apenas convites pendentes/consumidos; não reverte senhas já
definidas nem memberships ativadas. Antes do rollback, desabilite a criação e o
consumo de convites na aplicação. Nunca execute o rollback sem backup.

## Rate limiting

O projeto usa uma abstração própria sem dependência adicional:

- distribuído: Upstash Redis REST com `EVAL` atômico;
- fallback: mapa local por instância, apenas defesa adicional.

Variáveis necessárias na Vercel:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Sem essas variáveis, o fallback local não oferece limite global em ambiente
serverless. Configure Upstash antes do tráfego real e monitore respostas 429.

## Cron

`CRON_SECRET` é obrigatório. A rota falha fechada quando a variável ou o
cabeçalho `Authorization: Bearer ...` estiver ausente ou incorreto.
