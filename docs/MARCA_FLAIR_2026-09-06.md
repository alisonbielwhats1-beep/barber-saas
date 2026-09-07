# Marca Flair — direção 3 escolhida pelo responsável

Atualização de 07/09: a entrada clara e curta do cliente descrita abaixo foi
substituída por grafite com luzes móveis verde/lilás e 2,2 segundos, a cada
nova abertura do aplicativo. A regra administrativa permanece inalterada.
Ver `CLIENTE_CORES_ENTRADA_2026-09-07.md` e o status canônico.

A proposta 3 substitui o monograma EF anterior: símbolo de duas curvas e
lettering arredondado Everflair. O responsável também solicitou aplicação na
landing com lilás discreto e entrada animada no aplicativo do cliente.

## Aplicação

- `public/images/brand/everflair-flair-mark.png` e `everflair-flair-logo.png`:
  arquivos PNG com transparência real, derivados da proposta aprovada usando
  a ferramenta integrada de geração de imagens. São raster, não vetores.
- `src/components/brand.css`: máscaras que herdam a cor do contexto, incluindo
  tema escuro e alto contraste. A marca compartilhada atualiza menu, landing,
  login, convites e demonstrações que usam BrandLogo/BrandMark.
- `src/components/marketing/flair.css`: lilás #69499C na marca e detalhes,
  #F0EAFB nas seleções e #C7B4E5 no escuro. Superfícies amplas e CTAs preservam
  a base neutra. Acentos limitados a seleção, foco, plano destacado, ícones e
  iluminação suave; a identidade do estabelecimento continua independente.
- `src/components/brand-intro.tsx`: entrada de 1,4 segundo, agora com chave
  por sessão de aba e estabelecimento. Ver a entrada administrativa não impede
  a entrada do cliente. Trocar de página no mesmo estabelecimento não repete.
  Tecla/toque dispensam o efeito. Movimento reduzido e storage indisponível
  deixam o conteúdo diretamente acessível. A animação não espera dados nem
  indica autenticação ou carregamento concluído.
- `scripts/generate-pwa-icons.ts`: favicon e ícones de instalação derivados
  do símbolo escolhido, com cor sólida e espaço seguro para máscaras do SO.
  `public/sw.js`: versão de cache atualizada para os novos ícones.

Prompts utilizados na ferramenta integrada: extrair somente o símbolo da
proposta 3 preservando suas duas curvas, produzir composição horizontal com
o nome Everflair da mesma proposta e remover o fundo com alpha real. Exportação
local com Sharp apenas para dimensões, transparência e ícones da aplicação.
Os assets anteriores permanecem versionados, sem uso nos componentes atuais.

## Validação

Rodar lint, TypeScript, Vitest e build. A suíte de entrada cobre StrictMode,
sessões independentes, navegação interna, acessibilidade e storage indisponível.
Playwright verifica a landing clara/escura/mista em desktop e celular, máscaras,
contraste, overflow e a entrada real do cliente no PostgreSQL efêmero do GitHub.
Resultados por commit nos checks do PR #79. Sem mudança de banco ou promoção
produtiva nesta revisão.
