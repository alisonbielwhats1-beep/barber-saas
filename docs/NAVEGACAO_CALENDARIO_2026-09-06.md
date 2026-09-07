# Menu compacto, calendário e lilás — Everflair

Solicitação: retirar o lettering e “Painel de operação” do topo, manter apenas
o símbolo EF, permitir recolher o menu e abrir um calendário à esquerda da
agenda, preservando fotos/nomes e o tema claro. O responsável autorizou explorar
lilás/roxo como extensão da paleta; isso substitui a restrição anterior de não
adicionar essa família à interface administrativa.

## Implementação

- Topo com o monograma aprovado, sem lettering nem subtítulo repetido.
- Menu de 224 px recolhível para 72 px, com preferência local persistida.
  Ícones continuam nomeados e têm tooltip; troca de estabelecimento, busca,
  conta, tema e saída permanecem acessíveis.
- Navegação rola separadamente do topo e dos controles da conta.
- Calendário à esquerda em telas a partir de 1280 px, recolhível. No celular e
  tablet, o botão abre uma janela com foco contido, Escape e retorno de foco.
- Consulta de meses sem alterar a agenda; seleção de dia, retorno para hoje e
  saltos de ±1/2/3 semanas. Setas, Home/End e PageUp/PageDown permitem navegar
  pelo teclado. Datas civis seguem a data e o hoje do estabelecimento.
- Fotos cadastradas e nomes permanecem no cabeçalho da grade; ausência de foto
  continua usando iniciais. Não foram criadas fotos fictícias para clientes reais.

## Direção de cor

Marfim e grafite continuam nas superfícies e no texto. Lilás claro é usado no
item selecionado do menu; roxo profundo no dia escolhido e no contorno de foco.
São tokens de seleção, sem substituir as cores dos status dos atendimentos.
Verde e vermelho operacionais permanecem. O tema escuro mantém seus neutros.

Tokens do claro: seleção HSL `263 65% 95%`; texto selecionado `263 38% 38%`;
dia/foco `263 36% 45%`. Branco no dia ativo; texto escuro no lilás suave.

## Arquivos e verificação

- `src/app/(admin)/admin-sidebar.tsx`, layout, navegação, footer, seletor de salão
  e botão de busca: estados expandido/compacto.
- `src/app/(admin)/agenda/date-navigator.tsx` e `agenda-board.tsx`: calendário.
- `src/app/globals.css`: tokens de seleção restritos ao tema administrativo.
- `date-navigator.test.tsx`: mês bissexto, passagem de ano por teclado e semanas.
- `tests/e2e/agenda-navigation.spec.ts`: persistência do menu, rotas por data,
  calendário móvel, foco, contraste e capturas, somente no banco efêmero do CI.

Lint, TypeScript, testes e build são exigidos; resultados por commit nos checks
do PR #79. Não há mudança de schema, dado produtivo ou promoção nesta revisão.
