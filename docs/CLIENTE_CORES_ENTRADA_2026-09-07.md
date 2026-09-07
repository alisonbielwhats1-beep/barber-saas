# Aplicativo do cliente — entrada e cores

Revisão solicitada pelo responsável para tornar a abertura animada perceptível,
substituir botões marfim e dar cor aos contatos e ao bloco das reservas.

## Comportamento

- Entrada do cliente em grafite esverdeado, marca clara, luzes móveis verde e
  lilás e um círculo que se expande. Duração total de 2,2 segundos, com saída
  suave. O efeito reaparece em uma nova abertura/recarregamento do aplicativo,
  mas não em navegação interna no mesmo estabelecimento. O painel mantém sua
  regra anterior de sessão e duração. Tecla/toque dispensam imediatamente;
  movimento reduzido pula a introdução.
- CTA principal verde #126949 com texto branco; botões, seleção de horário,
  preços e atalho central de agendamento usam verde claro legível no grafite.
  Lilás permanece como acento secundário. Sem alterar fontes ou estrutura.
- Contatos: WhatsApp verde, Instagram em gradiente roxo/rosa/laranja,
  ligação azul, site lilás e conteúdo cobre. Endereço em coral, horário azul
  e pagamento lilás. Canais continuam aparecendo somente quando cadastrados.
- O bloco inteiro da reserva recebe a cor do estado: confirmado verde,
  cancelado/não compareceu vermelho, pendente âmbar, em atendimento azul.
  Concluídos permanecem discretos. Texto, ícone e selo identificam o estado
  sem depender apenas da cor; datas, valores e histórico são preservados.

## Arquivos e validação

- `src/components/brand-intro.tsx`, `brand.css`, `brand-intro.test.tsx`:
  movimento e ciclo de entrada, inclusive StrictMode e navegação interna.
- `src/app/globals.css`: tokens exclusivos do aplicativo do cliente.
- `src/components/ui/dialog.tsx` e `client-shell.tsx`: contexto de tema
  preservado nos portais de revisão, avaliação, cancelamento e instalação.
  As janelas do painel continuam herdando o tema administrativo.
- `src/app/book/[salonSlug]/client-theme.css`, `layout.tsx`, `page.tsx`,
  `bottom-nav.tsx`, `minhas/minhas-list.tsx`: superfícies e estados.
- `tests/e2e/flair-brand.spec.ts`: entrada real, duração, nova abertura e
  movimento reduzido. `database-flows.spec.ts`: reserva confirmada em celular,
  contraste axe e ausência de overflow após o fluxo real de agendamento.

Verificações: lint, TypeScript, Vitest e build, com jornadas autenticadas em
PostgreSQL descartável no GitHub. Resultados por commit no PR #80.
Conferência visual local usa somente dados sintéticos. Sem mudança de banco,
env, envio externo ou promoção produtiva nesta revisão.
