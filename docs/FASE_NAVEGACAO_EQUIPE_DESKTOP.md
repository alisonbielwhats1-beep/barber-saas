# Fase — navegação desktop, equipe e configurações

Atualizado em **14/09/2026**. Entrega no PR #108, com Preview Vercel e promoção
explicitamente autorizada pelo responsável. Publicado em `a78a0b2`, após CI
`34801262205`, Production `dpl_HSg1kevPyCeDpV6Er1fhVKHRHLTC` READY.
O resultado final está registrado em
https://github.com/alisonbielwhats1-beep/barber-saas/pull/108#issuecomment-5658675856.
Os registros de preparação abaixo são históricos. Não reaplicar a migration.

## Objetivo

- iniciar o painel desktop com a navegação principal recolhida;
- reduzir a quantidade de ícones principais agrupando módulos por área;
- usar `UsersRound` para representar Equipe e abrir navegação contextual;
- oferecer navegação contextual também para Clientes e seus segmentos;
- reorganizar o índice de Configurações em cards no desktop, preservando o
  comportamento mobile existente;
- incluir foto, nome, sobrenome, e-mail e telefone no cadastro do profissional.
- destacar no topo desktop o plano do estabelecimento e o acesso à contratação
  ou alteração de plano, conforme pedido complementar do responsável.

## Acesso aos planos no topo

O proprietário vê um atalho âmbar com ícone de coroa, legível nos temas claro
e escuro. Sem plano pago, mostra “Ativar plano”; com plano, exibe o nome e a
capacidade vigentes ao lado de “Alterar plano”. Usa os termos confirmados pelo
servidor, incluindo agendas adicionais, e abre o portal de assinatura existente.
Na entrega #108, planos legados mantinham seu nome. O complemento em revisão no
PR #110 padroniza apenas a apresentação de `PRO` como “Essencial” e leva o mesmo
atalho ao topo mobile, com nome e “Alterar plano” em duas linhas. Enum, preço,
capacidade, assinatura e dados existentes não mudam.
Contratação desabilitada leva à seção Meu plano.
Nenhuma cobrança é iniciada pelo atalho; cotação, confirmação, permissões e
flags da troca continuam sendo validadas pelo fluxo de assinatura existente.
O componente foi inspecionado em 1280 px nos dois temas, sem overflow e sem
violações WCAG 2 A/AA e 2.1 AA apontadas pelo axe. Esta é evidência visual local
com dados fictícios, não uma contratação ou troca financeira real.

## Direção visual

O Everflare mantém seu tema escuro premium, verde esmeralda, tokens semânticos,
Lucide e componentes Radix/Tailwind. As referências do Fresha orientam apenas a
arquitetura: barra compacta, seção contextual e cards de configuração. Não há
cópia de marca, cor, texto ou composição proprietária.

No desktop, a navegação passa a usar oito áreas principais. Equipe, Clientes,
Catálogo, Resultados e Crescimento mostram um segundo painel com os destinos da
área. No mobile, os módulos e as Configurações mantêm o padrão já implantado.

## Cadastro e convite

Nome e sobrenome são apresentados separadamente no formulário e persistidos no
campo público `User.name`. Telefone e foto ficam pendentes no convite e só são
gravados no novo usuário depois que o próprio profissional aceita o link e cria
sua senha. Uma conta já existente preserva seus dados pessoais atuais.

A senha continua privada: não é criada, exibida ou armazenada pelo dono.

## Mudança de banco

A migration Prisma aditiva
`20260913110000_professional_invite_profile_fields` acrescenta duas colunas
anuláveis em `UserInvite`:

- `pendingPhone text null`;
- `pendingAvatarUrl text null`.

Não há backfill, reescrita, remoção de dados, alteração de RLS ou mudança de
constraint. O inventário afetado contém somente a tabela `UserInvite`.

Os arquivos `preflight.sql` e `verify.sql` são somente leitura. Desenvolvimento
e homologação devem identificar inequivocamente um alvo não produtivo. A execução
produtiva descrita abaixo é uma promoção específica autorizada, não um ambiente
de testes nem autorização para migrations futuras.

## Preparação produtiva autorizada — 14/09/2026

- PR #109 já publicado em `225c9c9`; incorporado ao #108 em `779e09e`.
- CI completo da revisão anterior `bf1ff5c`: run `34798368695` aprovado; a revisão
  integrada passou no job `check` do run `34800544049`, incluindo os testes
  PostgreSQL. A promoção do código aguarda a rodada final completa.
- Projeto confirmado pelo dashboard: `barber-saas`, `main PRODUCTION`, ref
  `vshnatkzxdekkvqttvbv`. Preflight: um convite, 24 colunas, novas colunas ausentes.
- Backup delimitado aos dados e metadados de `UserInvite`, criptografado no banco
  com a chave pública de recuperação existente antes da saída dos dados. Arquivos
  fora do Git, com ACL restrita ao usuário do Windows e SYSTEM:
  `C:/Users/Usuário/.codex/backups/everflair/production-2026-09-14-pr108/`.
  Chaves preservadas em `../production-2026-09-07/keys`.
- Decifragem em memória, JSON, escopo, contagem e SHA-256 conferidos às
  03:01:04 UTC. Conteúdo: 35.667 bytes; SHA-256
  `2b9913f570f7dfd809702b705af2ffd3976381f4c3cb694896f4f84682c9039c`.
  Nenhum dado decifrado foi gravado em arquivo, log, CI ou banco de teste.
- Migration aplicada em transação com limites de lock/execução, comparação
  integral das colunas anteriores e registro em `_prisma_migrations`. Checksum
  do SQL versionado: `476fe74a179309a8f9cb894b093eea7f690a1cd6e92fff328bf98130640f9ee8`.
- Verificação: `pendingPhone` e `pendingAvatarUrl` presentes como `text NULL`.
  Sem seed, reset, db push, backfill, alteração de flags ou reaplicação de SQL antigo.

O backup é delimitado, não um dump integral do projeto. Recuperação de dados
exige autorização específica e preservação das escritas posteriores; o rollback
normal é de código, conservando as colunas e o histórico.

## Rollback

O rollback seguro é promover o código anterior e manter as duas colunas
anuláveis inertes. Removê-las poderia apagar telefone ou foto de convites ainda
pendentes e, por isso, não faz parte do rollback. Nenhum SQL destrutivo está
autorizado por este documento.

## Verificação exigida

- `npm run lint`;
- `npx tsc --noEmit --incremental false`;
- `npm test`;
- `npm run build`;
- `schema-smoke` e testes PostgreSQL no CI;
- inspeção em 375, 768, 1024, 1280 e 1440 px, nos temas claro e escuro;
- Preview isolado antes de qualquer aprovação para Production.

## Verificação local desta entrega

- lint, TypeScript, 1.061 testes Vitest e build de produção: aprovados;
- matriz visual em 375, 768, 1024, 1280 e 1440 px, nos temas claro e escuro:
  sem rolagem horizontal e sem sobreposição entre conteúdo e navegação;
- formulário de novo profissional inspecionado em 1440 px;
- PostgreSQL e Docker não estão disponíveis nesta máquina. A homologação de
  banco usa PostgreSQL 16 descartável no GitHub Actions; a execução produtiva
  posterior e autorizada está registrada acima.
- os jobs `check` e `schema-smoke` executam preflight, migration e verificação
  em seus bancos PostgreSQL descartáveis antes dos testes de integração.
