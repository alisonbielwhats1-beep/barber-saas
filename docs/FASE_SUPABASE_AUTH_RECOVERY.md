# Recuperação por Supabase Auth — candidata, não ativada

## Auditoria e decisão de 20/09/2026

Production autentica o painel com NextAuth Credentials/bcrypt em `User` e o
cliente com bcrypt em `ClientProfile` + cookie `client_token`. Supabase era
banco/Storage; a recuperação anterior em `password-recovery-actions.ts` gerava
tokens próprios e enviava diretamente por Resend. Não basta trocar o e-mail:
alterar uma senha no Supabase não alteraria a senha usada pelo login legado.

O dono/equipe entra em `/login`; clientes entram em `/book/[salonSlug]/login`.
As experiências usam PremiumLoginShell/AuthShell e ClientAccessLayout,
respectivamente. Membership, salonId, sessionVersion, RLS e GUCs autorizam o
acesso. O responsável aprovou **uma identidade e uma senha por e-mail**, com
perfis, históricos e permissões separados. Depois pediu preservar produção e
clientes: nenhum deploy, importação de usuários ou alteração do Auth produtivo
foi executado nesta fase.

Inventário somente leitura: 31 usuários de painel, 83 perfis com senha, 111
e-mails normalizados distintos e nenhum usuário no Supabase Auth. Ambos os
projetos remotos disponíveis são produtivos; testes usam banco local/CI.

## Implementação

- `supabase-auth.ts`: único verificador de senha no modo Supabase. Não há
  fallback para bcrypt após recusa/erro do provedor. NextAuth e o cookie do
  cliente permanecem como transporte criptografado da sessão oficial.
- `supabase-recovery.ts`: `resetPasswordForEmail`, `verifyOtp(type: recovery)` e
  `updateUser`. Nenhuma senha/token próprio é persistido no banco nesse modo.
  O cookie temporário contém apenas sessão oficial cifrada, contexto e digest
  do link; HttpOnly, SameSite Strict, Secure em produção e expiração de 10 min.
- `AuthIdentity` vincula UUID do Supabase aos perfis existentes. A versão global
  revoga sessões de todos os aplicativos antes de alterar a senha; em falha
  confirmada do provedor permite repetir. Resultado incerto requer novo link.
  O vínculo por UUID, e não e-mail/metadados editáveis, concede acesso.
- `middleware.ts`: renova sessões oficiais antes da leitura de Server Components;
  credenciais nunca são expostas pelo callback público da sessão NextAuth.
- Novas rotas `/redefinir-senha`, `/book/[salonSlug]/redefinir-senha` e
  `/auth/confirm`; formulários e PasswordInput compartilhados mantêm layouts.
  Token é consumido ao enviar a nova senha, protegendo contra scanners de e-mail.
- Login, signup, convites, sessão do cliente e regras de identificação de conta
  reconhecem o vínculo oficial. Nenhuma policy tenant foi relaxada.
- Requisitos: dez caracteres, letras, números, máximo de 72 bytes, confirmação,
  mostrar senha, autocomplete, loading e feedback acessível. Solicitações de
  recuperação sempre retornam resposta genérica, inclusive erros específicos
  de conta no provedor. Rate limit por IP é independente da existência do e-mail.

## Supabase (configuração ainda necessária em produção)

1. Aplicar a migration aditiva `20260920191414_supabase_auth_identity` somente
   após preflight, backup/restauração verificados e autorização específica.
   Não rodar `db push` em produção. Preflight/verify/rollback estão na pasta.
2. Ativar Email Auth, confirmação de e-mail, senha mínima 10 e letras/números.
   Site URL: origem oficial do app do dono. Expiração de recovery: 3600 segundos.
3. Allowlist exata: `https://everflair.com.br/redefinir-senha`,
   `https://everflair.com.br/book/*/redefinir-senha`,
   `https://everflair.com.br/login`, `https://everflair.com.br/book/*/login`.
   Se os apps tiverem domínios diferentes, usar a origem de cada um nas entradas
   correspondentes. Não usar wildcard de domínio/Preview.
4. Instalar `supabase/templates/recovery.html` e `confirmation.html` nos templates
   Reset Password e Confirm Signup. O botão usa `.RedirectTo` e `.TokenHash`,
   preservando aplicação e salão; não usar somente `.SiteURL` para recovery.
5. Custom SMTP Resend: host `smtp.resend.com`, porta 465, usuário `resend`, senha
   = API key de envio Resend. Sender sugerido `acesso@auth.everflair.com.br`,
   nome `Everflair`. Ajustar limites à capacidade do plano. Desativar rastreamento
   de cliques nesses e-mails. SMTP password fica apenas no painel Supabase.

## Resend e DNS

Criado em 20/09/2026, por solicitação explícita: `auth.everflair.com.br`, região
São Paulo. ID `fb07cf16-a2ad-46f8-a482-c9168a31a5ee`. Registros salvos no
Registro.br e conferidos após reabrir a zona; Resend aguarda propagação DNS.
DNS autoritativo consultado: `e.sec.dns.br` / `f.sec.dns.br` (Registro.br).

Adicionar somente estes registros na zona `everflair.com.br`, sem mudar A,
nameservers ou MX do domínio principal. Valores copiados do painel Resend:

| Tipo | Nome | Conteúdo |
| --- | --- | --- |
| TXT | `resend._domainkey.auth` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDD2Lx4valfVtCDEzFL8Sk/uSTMtnjylcx1Lr2IAdc2DzN4gAEzefmgsWGa+D6HpUp7ex9nBZK0+/ilgsThVcvjSlxaKoJ4UQjELAC2lEMwoMjkB0rz1zVwloKH8Yd2PI0998KcfNjlsCnPuDgH3X2fXxAoxdm5AJG1Oj+FxpCR3wIDAQAB` |
| CNAME | `rsend.auth` | `rsend-sae1.forge.rmta.net` |
| CNAME | `send.auth` | `send.forge.rmta.net` |

A chave DKIM acima é pública, não é secret. TTL padrão do provedor. Recebimento
de e-mail permanece desativado. Não substituir DMARC existente nem adicionar
outro SPF na mesma origem. Validar pelo painel após propagação DNS.

## Vercel e secrets

| Variável | Valor/uso |
| --- | --- |
| `AUTH_PROVIDER` | `legacy` por padrão; `supabase` somente na ativação revisada |
| `AUTH_EMAIL_ENABLED` | `true` somente após configuração e validação de SMTP |
| `SUPABASE_URL` | URL do mesmo projeto que contém os dados |
| `SUPABASE_AUTH_PUBLISHABLE_KEY` | publishable/anon key; somente ambiente servidor |
| `OWNER_APP_URL` | `https://everflair.com.br` |
| `CLIENT_APP_URL` | `https://everflair.com.br` (mesma origem hoje) |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | manter configuração existente |

Upstash/rate limit permanece obrigatório em produção. Chave service role só
é necessária no processo offline de importação; não inserir como dependência
do runtime de login/recovery. Resend API key de SMTP não vai ao frontend ou Git.
`RESEND_API_KEY`/`EMAIL_FROM` existentes continuam destinados aos demais e-mails.

## Migração e impacto que impede ativação silenciosa

O schema é aditivo; `AUTH_PROVIDER=legacy` preserva a autenticação existente.
Não ativar sem migrar todos os vínculos. `scripts/migrate-supabase-auth.ts`
executa inventário sem PII por padrão; `--apply` importa via Auth Admin API,
preservando hashes bcrypt quando há uma única conta e IDs/histórico do domínio.
E-mails compartilhados precisam definir uma senha única pelo recovery.
IDs determinísticos + marcador de migração permitem retry sem anexar identidades
alheias apenas por coincidência de e-mail. Conflitos interrompem a importação.

Cadastros antigos não possuem prova de confirmação de e-mail. O importador
**não os marca como verificados**: a ativação exige confirmação/recuperação e
novo login, portanto pode afetar clientes. Essa etapa exige plano de transição
aprovado; o pedido de não afetar clientes impede ativá-la agora sem resolver
esse impacto. Para produção o script também exige target inequívoco,
`AUTH_MIGRATION_APPROVAL=APPROVED_IDENTITY_IMPORT_WITH_BACKUP` e
`AUTH_MIGRATION_BACKUP_REFERENCE`. Esses valores não substituem autorização.

Antes da ativação, rollback é manter o provider legado e o schema aditivo.
Depois da primeira senha alterada no Supabase, **não retornar ao bcrypt**:
hashes antigos estão desatualizados. Pausar acesso/recovery e corrigir adiante
é o procedimento seguro; não restaurar dados antigos sobre dados de clientes.

## Validação

Workflow `auth-recovery.yml` inicia Supabase Auth e Mailpit descartáveis em CI,
sem secrets remotos. Exercita solicitação, e-mail SMTP real local, link,
alteração no provedor, login correto, replay, expiração, refresh e acesso direto
em desktop/mobile. Isso não equivale a entrega real por Resend.

Testes unitários cobrem configuração, isolamento, mensagens genéricas e
invalidação; integração PostgreSQL cobre RLS/concorrência. Resultados finais
e limitações são registrados no PR. Não declarar produção pronta antes de
DNS verificado, SMTP configurado, migração aprovada e entrega real demonstrada.
