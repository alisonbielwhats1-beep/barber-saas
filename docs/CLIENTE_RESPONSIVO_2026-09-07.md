# Cliente — cabeçalho, primeiro acesso e serviços

Solicitação posterior à publicação do PR #80: corrigir os cortes no topo,
retirar lupa/ampliação e área de foto do logo, unificar o acesso de primeira
vez e retirar fotos dos serviços na jornada de agendamento.

## Alterações

- `client-shell.tsx` e `client-theme.css`: espaço para áreas seguras superior
  e laterais, sem ocultar overflow como solução. Cabeçalho pode quebrar linha;
  nome do salão fica separado dos controles e sem truncamento.
- Home e acesso usam `BrandLogo`, com máscara contain e dimensões limitadas.
  `salon-logo-lightbox.tsx` removido; não há lupa, círculo de foto ou modal.
- `client-access-layout.tsx`: composição compartilhada de boas-vindas, login
  e cadastro, com marca lilás, fundo grafite, cartão e ação verde. Layout segue
  o fluxo natural e pode rolar em telas baixas, sem centralização que corta o
  topo. Campos de 16 px e foco visível.
- `welcome/page.tsx`: ações de autenticação aparecem uma única vez; retorno
  seguro acompanha tanto login quanto cadastro, preservando serviço escolhido.
  Gate e isolamento de sessão por estabelecimento permanecem no servidor.
- `home-explore.tsx`: categorias compactas sem foto, serviços com nome,
  descrição, duração e preço. `agendar/booking-flow.tsx`: ícones discretos em
  lugar das miniaturas; retratos dos profissionais permanecem.
- Imagens cadastradas não são apagadas. Produtos, portfólio e capa da vitrine
  permanecem disponíveis. Sem schema, migration ou alteração de dados.

## Validação

Lint, TypeScript, Vitest e build. Testes de retorno seguro e jornada real de
cadastro/agendamento. E2E em PostgreSQL descartável verifica boas-vindas,
login, cadastro e home em 320×568, 390×844, 844×390 e 1280×800: marca inteira,
sem overflow horizontal, ausência de lupa/fotos de serviços, campos de 16 px,
contraste e acessibilidade. Resultados finais por commit no PR desta branch.
Conferência local somente com dados sintéticos; instalação física iOS não
disponível. Esta revisão não publica automaticamente uma nova versão produtiva.
