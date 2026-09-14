# Fase — navegação desktop, equipe e configurações

Atualizado em **13/09/2026**. Entrega em revisão no PR #108, com Preview Vercel.
Nada desta fase foi aplicado em Production ou no Supabase.

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
Planos legados mantêm seu nome. Contratação desabilitada leva à seção Meu plano.
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

Os arquivos `preflight.sql` e `verify.sql` são somente leitura. Antes de uma
execução fora do CI descartável, é obrigatório identificar inequivocamente o
projeto e confirmar que não se trata de Production. A migration deve passar no
PostgreSQL efêmero do `schema-smoke` e depois em homologação separada antes de
qualquer pedido de promoção.

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
- PostgreSQL e Docker não estão disponíveis nesta máquina. Por isso, a
  migration ainda depende do `schema-smoke` com PostgreSQL 16 descartável e
  não foi executada contra nenhum banco remoto.
- os jobs `check` e `schema-smoke` executam preflight, migration e verificação
  em seus bancos PostgreSQL descartáveis antes dos testes de integração.
