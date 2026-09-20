# Agenda — microetapa 1: controles e avisos compactos

## Escopo

Proposta visual aprovada na tarefa em 19/09/2026, com reforço explícito para
preservar regras e lógica do backend. Branch `codex/agenda-ux-mobile`, baseada
em `origin/master` `87b8ffc` (PR #110), em worktree isolado. As alterações locais
preexistentes em `codex/scrollcraft-barber-saas` foram preservadas.

`docs/UX_MOBILE_PLAN.md` não existe nesta base. A referência complementar é a
seção Agenda do roteiro fornecido pelo responsável e a proposta da tarefa.
A análise inicial havia usado uma cópia antiga: a base atual já possui busca
de clientes no servidor, visitas com vários profissionais e revisão. Esses
recursos e as regras atuais de remarcação devem ser preservados nas próximas
microetapas; prevalecem `STATUS_ATUAL.md` e
`VISITAS_MULTIPROFISSIONAIS_2026-09-13.md` sobre as limitações da análise inicial.

## Alteração de apresentação

- No celular, “Mostrar dia inteiro” passa ao painel de filtros, junto às cores;
  o desktop conserva o atalho. A data e as setas ganham espaço na barra.
- Filtros aplicados recebem contador, resumo visível e “Limpar filtros”. Limpar
  restaura todos os profissionais, status Agenda e busca vazia, sem alterar
  a preferência de cores nem o intervalo visual do dia.
- Avisos ficam recolhidos em uma linha expansível, mantendo contagens, conteúdo
  e link existentes. O detalhe identifica o intervalo carregado (grade mensal,
  incluindo dias adjacentes) e explicita que as contagens independem dos filtros.
- Erros de ação continuam visíveis. A grade e seus dois profissionais, cartões,
  cores, ações rápidas, permissões, payloads e chamadas de servidor não mudaram.

O único arquivo funcional alterado é `src/app/(admin)/agenda/agenda-board.tsx`.
Sem mudança de API, Server Action, domínio, schema, migration, dados ou flags.
Não reintroduz os indicadores que já foram retirados na versão atual.

## Verificação local

- `npm run lint`: aprovado.
- `npx tsc --noEmit --incremental false`: aprovado.
- `npm test -- --maxWorkers=4`: 206 arquivos / 1.106 testes aprovados.
- `npm run build`: aprovado, 58 páginas estáticas geradas.
- Chromium em 320, 360, 390, 430, 768, 1024 e 1280 px: sem overflow da página,
  sem erros JavaScript; seleção, contador, limpeza, retorno de foco, dia inteiro,
  expansão dos avisos e período de referência conferidos.

A revisão de navegador usa o componente real em um harness local isolado em
`.demo/agenda-preview/`, com dados fictícios e sem conexão de backend. Componentes
de mutação são substituídos somente nesse harness ignorado pelo Git. Não se
trata de jornada autenticada, teste de persistência ou alteração da segurança
da aplicação. Capturas antes/depois e métricas estão na mesma pasta.
No cenário 390×844 com avisos, a altura útil da grade passou de 492 para 560 px.
Os números se referem ao harness, não ao shell completo do aplicativo.

## Limites e continuidade

O ajuste da grade em 320 px permanece para a microetapa seguinte: a segunda
coluna já exige rolagem interna na base atual. Esta etapa não muda essa geometria.
O fluxo Cliente → Serviços → Revisão da imagem aprovada ainda não foi aplicado
ao novo agendamento nesta entrega. Revisão do responsável antes de prosseguir.

Sem publicação em Production. CI e Preview devem ser conferidos no PR;
Preview protegido não substitui homologação autenticada em banco sintético.
Recuperação: reverter este commit de apresentação, sem operação no banco.
