# Prompt econômico para a próxima fase

Use este prompt em vez de reenviar os dez documentos completos.

```text
Projeto: alisonbielwhats1-beep/barber-saas
Stack real: Next.js 15 App Router, TypeScript, NextAuth, Prisma, PostgreSQL
Supabase e Vercel. Não assuma Flutter nem Supabase Auth.

Leia primeiro:
1. CLAUDE.md
2. docs/fase-1-seguranca.md
3. docs/auditoria-geral-2026-07-29.md
4. somente o diff/arquivos da tarefa atual.

Objetivo desta execução:
[DESCREVA UM ÚNICO LOTE]

Regras para economizar tokens:
- não repita o contexto do projeto;
- não inventarie o repositório inteiro se o diff bastar;
- use rg/git diff e abra apenas arquivos diretamente relacionados;
- responda em até 1.200 palavras, salvo bloqueador crítico;
- cada achado deve ter: severidade, evidência arquivo:linha e correção;
- agrupe itens repetidos;
- se não houver achado, diga explicitamente;
- faça no máximo 3 perguntas, somente se forem bloqueadoras;
- não implemente nada antes de eu aprovar o lote;
- não altere banco, migration, dependência, segredo ou deploy nesta etapa.

Prioridades fixas:
P0 = vazamento cross-tenant, perda/corrupção de dados, dupla reserva, auth,
segredo, migration insegura ou produção indisponível.
P1 = agenda, onboarding, convite, pagamento, upload, rate limit e operação.
P2 = UX, acessibilidade, performance, métricas e billing.
P3 = IA, animação e expansão.

Entrega:
1. veredito;
2. P0/P1 com evidência;
3. o que já está correto;
4. menor lote seguro;
5. arquivos afetados;
6. testes obrigatórios;
7. rollout e rollback;
8. decisão solicitada.
```

## Prompt recomendado para usar agora

```text
Audite somente o PR #3 (feat/email-professional-invites) contra origin/master.
Não altere arquivos e não conecte ao banco de produção.

Confirme:
- causa exata do preview Vercel com falha;
- migration compatível com o schema e aplicável antes do código;
- token forte, hash, expiração, revogação e uso único;
- criação de User/Membership/Professional/ProfessionalService atômica;
- corridas em criar, reenviar, cancelar e aceitar;
- conta global não pode ser assumida por outro salão;
- e-mail não entregue não deixa estado impossível;
- Resend não expõe token, PII ou segredo em logs;
- rate limits distribuídos e identificadores seguros;
- rollback e reconciliação do convite legado;
- testes reais ainda necessários em PostgreSQL.

Entregue no máximo 1.200 palavras:
veredito, bloqueadores, achados importantes, testes PostgreSQL obrigatórios,
rollout seguro e lista exata de correções. Não implemente.
```
