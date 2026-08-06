## Objetivo

<!-- O que muda e por quê? -->

## Segurança de ambiente

- [ ] Não usei banco, secrets ou dados de produção
- [ ] Confirmei a branch e o ambiente de destino
- [ ] Testes de banco usam PostgreSQL efêmero/local ou Supabase de homologação
- [ ] Logs e artefatos não expõem credenciais nem dados pessoais

## Banco e multi-tenant

- [ ] Toda operação tenant-scoped valida `salonId`
- [ ] Permissões foram validadas no servidor
- [ ] A migration preserva dados e possui preflight/verificação
- [ ] Há rollback seguro ou plano explícito de roll-forward
- [ ] Índices/constraints novos têm justificativa e teste

## Agenda e tempo

- [ ] Horários usam o timezone IANA do estabelecimento
- [ ] Não há ajuste manual de offset
- [ ] Conflito e concorrência foram considerados no servidor/banco
- [ ] Cache, realtime, dashboard e notificações foram considerados

## Verificação

- [ ] Lint
- [ ] Typecheck
- [ ] Testes unitários
- [ ] Testes de integração aplicáveis
- [ ] Build
- [ ] Fluxo mobile aplicável

## Rollback

<!-- Como reverter sem perder dados? -->
