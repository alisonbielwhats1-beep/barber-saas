# Recuperação por Supabase Auth — publicada em 20/09/2026

PR #115, commit `f4d4ebbbac65ecd2f4d23cf89304a196658d646e`, deployment Production
`dpl_J6DY6d7jgtzUmMDjgig8zwxLdu5P` READY. Health confirmou versão e banco saudável;
home e seis rotas de autenticação/recovery dos dois aplicativos HTTP 200.
SMTP real confirmado: Resend Delivered em 20/09 às 17:53 BRT, mensagem
`01a0c098-79f4-7489-b532-3caf44c5e28d`, solicitada pelo responsável para sua conta.
Remetente e botão `/redefinir-senha` corretos. A solicitação manteve hashes,
vínculos, sessões e 2.321 reservas; criou somente a identidade oficial sem senha.
Não foi alterada senha produtiva para teste. Os cenários completos foram
exercitados no Supabase/SMTP descartáveis descritos abaixo.

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
perfis, históricos e permissões separados. A decisão final aprova publicação
com transição voluntária: manter cada senha atual até a pessoa concluir uma
recuperação, quando a nova senha vale para os acessos daquele e-mail. Nenhuma
importação em massa foi executada. A publicação e a preparação do Auth/schema
estão registradas acima; a auditoria desta seção descreve o ponto de partida.

Inventário somente leitura: 31 usuários de painel, 83 perfis com senha, 111
e-mails normalizados distintos e nenhum usuário no Supabase Auth. Ambos os
projetos remotos disponíveis são produtivos; testes usam banco local/CI.

## Implementação

- `supabase-auth.ts`: verificador oficial para contas vinculadas ao Supabase.
  Contas antigas sem vínculo continuam usando bcrypt; não há fallback para
  bcrypt após recusa/erro do provedor em uma conta já vinculada. NextAuth e o
  cookie do cliente transportam a sessão oficial ou a sessão legada ainda válida.
- `legacy-supabase-transition.ts`: provisiona identidade sem senha somente na
  solicitação de recuperação de uma conta existente. Mantém hashes e vínculos
  antigos intactos até `verifyOtp` comprovar o e-mail e `updateUser` ter sucesso.
  Em seguida, uma transação vincula os perfis registrados e remove os hashes
  antigos. Perfis convidados, IDs, reservas e histórico não são alterados.
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

## Supabase (configuração aplicada em produção)

Preparação confirmada em 20/09: Site URL e as quatro URLs abaixo salvas no
projeto `vshnatkzxdekkvqttvbv`; Email Auth/confirm email ativos; mínimo de dez
caracteres, letras e números, expiração 3600s conferidos no painel. SMTP Resend
salvo pelo responsável; templates recovery e confirmation instalados. Não há
contas migradas.

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
Registro.br e conferidos após reabrir a zona. O DNS autoritativo publicou os
registros e o painel Resend confirmou **Verified**. SMTP do Supabase configurado
com remetente `acesso@auth.everflair.com.br` e chave restrita a envio por esse
subdomínio. O A principal e CNAME www permanecem com os mesmos valores.
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
| `SUPABASE_SERVICE_ROLE_KEY` | já usada no servidor para Storage; também provisiona a identidade Auth sob demanda |
| `OWNER_APP_URL` | `https://everflair.com.br` |
| `CLIENT_APP_URL` | `https://everflair.com.br` (mesma origem hoje) |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | manter configuração existente |

`SUPABASE_AUTH_PUBLISHABLE_KEY`, `OWNER_APP_URL` e `CLIENT_APP_URL` foram salvas
apenas no ambiente Production em 20/09. A service role já existia nesse ambiente.
`AUTH_PROVIDER=supabase`/`AUTH_EMAIL_ENABLED=true` também foram salvas somente
em Production e estão ativas no deployment publicado acima.

Upstash/rate limit permanece obrigatório em produção. A chave service role é
exclusiva do servidor, usada apenas para preparar a conta oficial sem senha;
login, validação de tokens e troca de senha usam a API oficial com chave pública.
Resend API key de SMTP não vai ao frontend ou Git.
`RESEND_API_KEY`/`EMAIL_FROM` existentes continuam destinados aos demais e-mails.

## Transição voluntária aprovada

O schema é aditivo; `AUTH_PROVIDER=legacy` preserva a autenticação existente
durante a preparação. Aplicar a migration antes de publicar o código, pois
as consultas passam a reconhecer `authIdentityId` mesmo com a flag desligada.
Não existe importação em massa. A ativação `AUTH_PROVIDER=supabase` preserva
login e sessões de contas sem vínculo oficial, incluindo senhas diferentes
para um mesmo e-mail. Não exige confirmação ou troca obrigatória.

Solicitar um link reserva um UUID em `AuthIdentity` e cria no provedor uma
identidade sem senha, não confirmada. Não copia hashes nem gera senhas. A chave
única de e-mail torna a reserva idempotente; conflitos com contas externas não
são adotados silenciosamente. Pedir ou ignorar o link mantém o acesso antigo.

Somente depois de comprovar posse do e-mail pelo token oficial e salvar a nova
senha, uma transação vincula contas registradas desse e-mail. Cada alteração
tenant usa `withSalon` e a mesma transação. Os IDs, Membership, reservas, notas
e históricos permanecem; convidados sem credencial não ganham acesso. Versões
de sessão invalidam o acesso antigo desse e-mail após a troca voluntária.
Uma falha antes do vínculo mantém as credenciais legadas e exige nova tentativa;
o aplicativo não declara sucesso sem concluir a transição.

Antes da ativação, rollback é manter o provider legado e o schema aditivo.
Depois da primeira senha alterada no Supabase, **não retornar ao bcrypt**:
hashes antigos estão desatualizados. Pausar acesso/recovery e corrigir adiante
é o procedimento seguro; não restaurar dados antigos sobre dados de clientes.

## Validação

Revisão de código `29ab5a6`: lint, TypeScript, build e 1.158 testes unitários
locais aprovados. Cinco jornadas Supabase Auth + SMTP Mailpit passaram no CI
`35534983208`. Uma verificação PostgreSQL local adicional confirmou a transição
com `app_runtime` sem BYPASSRLS, invisibilidade dos perfis sem GUC e vínculo em
dois tenants com GUC. O CI geral `35534983210` passou: check e schema-smoke,
incluindo restauração de banco sintético, rollback, RLS, jornadas autenticadas,
38 verificações públicas, 36 visuais e matriz responsiva. Duas jornadas legadas
(visita conjunta e recibos) passaram na repetição após timeout de navegação do
servidor de desenvolvimento; evidências preservadas pelo CI. PR #115 integrado
em `f4d4ebbbac65ecd2f4d23cf89304a196658d646e`; deployment READY confirmado acima.

Backup delimitado de `User`/`ClientProfile` criptografado dentro do banco e
verificado por decifragem somente em memória, checksum, formato e contagens.
Diretório restrito fora do Git: `%USERPROFILE%/.codex/backups/everflair/production-2026-09-20-pr115/`.
Baseline: 31 usuários, 195 perfis, 30 memberships e 2.321 reservas. SHA-256:
`8c94441511873e87019c8375f65f3533a7752d432311a4b1d7bc4ed11a5c80d8`.
Não é dump integral nem backup de Storage. A migration produtiva foi aplicada
às 20:44 UTC, histórico Supabase `20260920204453_supabase_auth_identity`, com
`lock_timeout=3s`, transação e comparação integral de User/ClientProfile antes
e depois (excluindo apenas a nova coluna nula). Nenhum registro/hash mudou.
Verificação: 31 usuários, 195 perfis, 30 memberships, 2.321 reservas e zero
identidades/vínculos. RLS/FORCE RLS preservadas; AuthIdentity não pode ser lida
por anon/authenticated, somente pelo runtime interno. Advisors sem alertas novos.
Não reaplicar essa migration pelo Prisma ou pelo histórico manual.

Workflow `auth-recovery.yml` inicia Supabase Auth e Mailpit descartáveis em CI,
sem secrets remotos. Exercita solicitação, e-mail SMTP real local, link,
alteração no provedor, login correto, replay, expiração, refresh e acesso direto
em desktop/mobile. Isso não equivale a entrega real por Resend.

Testes unitários cobrem configuração, isolamento, mensagens genéricas e
invalidação; integração PostgreSQL cobre RLS/concorrência e transição atômica.
O E2E também usa senhas antigas diferentes para dono/cliente com o mesmo e-mail,
compara a reserva inteira antes/depois e verifica que solicitar o link não muda
hashes, vínculos nem sessão. Resultados finais
e limitações são registrados no PR. Não declarar produção pronta antes de
DNS verificado, SMTP configurado, migration aditiva validada e entrega real demonstrada.
