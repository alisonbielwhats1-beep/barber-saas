# Cadastro, senha e e-mails do cliente — 09/10/2026

Estado: candidata em revisão, sem publicação nem mudança de configuração remota.
Base: origin/master `5a52c3caa1c7`; worktree/branch `codex/auth-password-audit`.
O responsável identificou o problema no link de agendamento e autorizou preparar
mínimo de oito caracteres com segurança. Nenhuma senha de cliente foi solicitada,
lida ou alterada. Nenhum e-mail de teste foi enviado em Production.

## Evidência atual

Consulta somente leitura do projeto Supabase `barber-saas` (`vshnatkzxdekkvqttvbv`),
identidade confirmada por list_projects. Janela padrão dos logs: últimas 24 horas
na consulta de 09/10/2026. Agregados, sem e-mails, IPs, tokens ou hashes:

| Evento | Quantidade |
| --- | ---: |
| /token: email_not_confirmed | 10 |
| /token: invalid_credentials | 23 |
| /signup: over_email_send_rate_limit (referer do Booksite) | 3 |
| /signup: HTTP 200 | 10 |
| /recover: HTTP 200 | 6 |
| /verify: HTTP 200 | 11 |

São tentativas, não pessoas. Login não tem referer suficiente para atribuir os dez
casos a um salão. Invalid_credentials inclui a tentativa feita pelo próprio
cadastro antes de signUp; não equivale a 23 reclamações. HTTP 200 de recovery não
comprova entrega na caixa de entrada. Não houve inspeção atual de Delivered/Bounce
no Resend nem associação de cada reclamação a um cliente.
Health público somente leitura: HTTP 200, banco ok, versão `5a52c3caa1c7`.

## Defeitos confirmados e correções da candidata

1. Login recebe null tanto para senha inválida quanto para e-mail não confirmado.
   Mantida a resposta genérica, com orientação visível para confirmar o e-mail e
   reenvio explícito pelo cliente; evita obrigar troca de senha e não revela conta.
2. registerClient chamava signUp antes de consultar conta persistida no tenant.
   Três testes novos falharam no original: retomada legada, retomada Supabase e
   recusa da senha incorreta sem novo signup. Agora consulta o tenant aprovado e
   usa login normal (e seus limites) antes de qualquer signup em uma retomada.
   Não altera hashes, perfis, vínculo, histórico ou senha existente. Perfis sem
   credencial continuam exigindo vínculo seguro pelo estabelecimento.
3. Cadastro capturava NEXT_REDIRECT como falha. Usa unstable_rethrow, como o login.
4. Link de confirmação inválido perdia o salão e mandava ao login do proprietário,
   sugerindo redefinir a senha. Agora preserva somente destino exato permitido;
   link usado pode voltar ao login normal, sem trocar a senha.
5. Cadastro validava só comprimento no navegador; letras/números falhavam apenas
   depois do envio. A interface Supabase usa o mesmo schema do servidor.

Reenvio: API oficial auth.resend(type: signup), sem senha ou mudança de credencial,
sem submissão automática. Cota global de IP (5/h) e e-mail (1/min), fail-closed,
consulta dentro de withSalonBySlug e resposta idêntica para conta inexistente,
confirmada, pendente, cooldown e falha de SMTP. Feedback não promete entrega.
Limites existentes de login/cadastro/recovery foram preservados.

## Política de senha e publicação coordenada

Nova regra Supabase compartilhada: mínimo **8 caracteres**, ao menos uma letra e
um número, máximo **72 bytes**. Espaços, maiúsculas e caracteres digitados não são
normalizados na senha; somente o e-mail é normalizado. Confirmação de senha e
rate limiting permanecem. Aplicada a cadastro de cliente/dono, convite e recovery
quando AUTH_PROVIDER=supabase. Logins antigos e modo legado mantêm compatibilidade.
Não exige trocar senhas existentes. Oito caracteres são o mínimo; senhas longas
e únicas continuam preferíveis. Não implementa medidor ou detecção de vazamentos.

`supabase/config.toml` muda somente o provedor LOCAL/CI para oito. A configuração
remota não é alterada por esse arquivo. O registro histórico de 20/09 aponta dez
no Supabase produtivo; esse valor não foi relido no painel nesta auditoria.
**Antes da promoção, conferir e sincronizar mínimo 8 no projeto confirmado,
mantendo letters_digits, confirmação, expiração e demais controles.** Não publicar
UI de oito mantendo servidor em dez. Exige aprovação de promoção conforme AGENTS.
Não há migration/schema/SQL de escrita nesta entrega.

Rollback de código: voltar ao commit anterior, preservando senhas já criadas com
oito; login já aceita essas senhas. Reverter o mínimo remoto para dez só restringe
novas criações/trocas e deve ser coordenado com a interface, sem tocar em contas.
A pausa de confirmação do dono, AUTH_PROVIDER e AUTH_EMAIL_ENABLED não mudam.

## Validação

- Baseline: 3/3 testes novos de retomada falharam antes da correção.
- Após correção inicial: 57 testes direcionados passaram; reenvio/configuração:
  14 testes passaram. Resultados finais da revisão ficam no PR.
- npm run lint: zero erros, seis warnings preexistentes fora do escopo.
- TypeScript, suíte geral, build e CI: resultados finais no PR; não inferir aprovação.
- Novo E2E com Supabase Auth + Mailpit descartáveis: cadastro real com oito,
  e-mail, bloqueio antes de confirmação, reenvio, link sem consumo no GET,
  confirmação, login com a senha ORIGINAL e link repetido no mesmo salão.
  Recovery de dono/cliente passa também a exercer senha nova de oito caracteres.
- Docker local está instalado, mas o daemon Linux não está em execução. A jornada
  completa roda no workflow auth-recovery.yml, sem dados/secrets produtivos.

## Limites remanescentes

A combinação confirmação pendente + feedback genérico + falta de reenvio é
compatível com as reclamações, mas não comprova causa única em cada conta.
Não há prova de corrupção de hashes. Entrega externa, spam/bounce, digitação do
e-mail e estado de contas específicas exigem evidência correspondente.
Persistência local e signup externo não são uma transação distribuída; falha de
banco depois de criar identidade ainda pode exigir repetir cadastro após confirmar
o e-mail. Esta candidata não promete resolver automaticamente qualquer identidade
órfã nem modifica registros reais para investigar.

Referências oficiais: [reenvio](https://supabase.com/docs/reference/javascript/auth-resend)
e [códigos de erro](https://supabase.com/docs/guides/auth/debugging/error-codes).
