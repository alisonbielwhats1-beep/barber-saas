# Refinamento da landing — setembro de 2026

Revisão posterior à versão ScrollCraft v2, orientada pelo feedback do usuário. Trabalho local, sem publicar ou modificar o banco.

## Referência confirmada

A landing publicada em https://salon-saas-ruby.vercel.app/ foi inspecionada no Chrome/Playwright em 05/09/2026. Texto, imagens e captura estão em `artifacts/refinement-v3/current-site.*`. A demonstração do aplicativo corresponde ao componente existente `src/app/landing-mobile-showcase.tsx`, e não a uma fotografia única. Suas telas de início, agendamento, reservas e avisos foram adaptadas em `client-app-preview.tsx`, preservando a estrutura e substituindo verde por champagne/grafite. Os dados do Espaço Aurora continuam ilustrativos.

Os quatro preços do site publicado coincidem com `PLAN_PRICING_ROWS`: Grátis R$ 0; Fundador R$ 49,90; Pro R$ 79,90; Equipe R$ 179,90. A nova apresentação usa essa fonte e `PLAN_ENTITLEMENTS`, incluindo limites de profissionais/agendamentos e disponibilidade de marketing, estoque e pacotes. A oferta Fundador continua limitada aos dez primeiros, sujeita à disponibilidade. Comparação horizontal acessível em telas pequenas.

## Alterações

- Espaço misto passa a integrar o seletor e a alternância automática. Identidade intermediária: superfícies pedra/marfim, navegação e painel financeiro em grafite, vidro dessaturado e fotografia de um espaço com múltiplos serviços. A proposta abrange beleza e bem-estar sem assumir uma identidade exclusivamente masculina ou feminina.
- A saída do hero reduz escala/deslocamento, dissolve fotografia, arquitetura e vidro gradualmente e compartilha o mesmo fundo com o produto. A entrada da agenda tem apenas 2 graus/16 px, substituindo a aproximação anterior de 9 graus/65 px.
- Botão circular Play/Pause removido. Preferência discreta de pausa por checkbox preserva o controle sobre movimento contínuo, além de foco/hover, visibilidade e `prefers-reduced-motion`.
- Agenda detalhada gerada a partir da captura real da visão diária: cinco profissionais, filtros, status, horários e indicadores. Nomes fictícios solicitados pelo usuário: Ana Martins, Rafael Costa, Camila Lima, Lucas Rocha e Beatriz Alves; clientes Mariana Souza, Gabriel Santos, Juliana Oliveira, Pedro Almeida, Fernanda Ribeiro, Bruno Ferreira, Larissa Melo e Carolina Mendes. Oito valores ilustrativos de R$ 80 totalizam R$ 640 previstos. Não são estatísticas ou clientes reais. A legenda informa a natureza ilustrativa. O módulo interno de agenda não foi modificado.
- Novas seções para financeiro, aplicativo do cliente e marketing. Recursos adicionais: portfólio, pacotes, clientes, catálogo/estoque, notificações e agendamento online. Conferidos nos módulos de origem; marketing oferece preparação manual, não disparos automáticos do WhatsApp. Nenhuma promessa de processamento de pagamentos, crescimento percentual, clientes reais ou aplicativos em lojas.
- Todos os CTAs da landing para cadastro incluem `?segment=` com valor validado. O servidor aplica a atmosfera antes da hidratação, evitando flash claro na barbearia, e inicializa o tipo de negócio/serviços sugeridos. A entrada tem uma animação curta, removida por movimento reduzido. IDs de estética e massagem apontam para o grupo real `estetica-bemestar`; misto aponta para `espaco-misto`. Consulta inválida mantém o comportamento padrão. A preferência não altera contas existentes nem callbacks de autenticação.

## Escopo e evidência

`signup/actions.ts`, `create-salon/actions.ts`, `login-form.tsx`, NextAuth, middleware e consultas de autorização não foram modificados. `useSegmentSelection` aceita apenas um valor inicial opcional; seu comportamento padrão e troca de serviços continuam iguais. O usuário confirma os dados ao enviar. Os testes de navegador não enviam cadastros válidos e não criam contas reais.

Novos assets: `public/images/brand-mixed.webp` e `public/images/product-agenda-refined.webp`. Gerados pela ferramenta nativa com autorização do usuário; sem copiar assets externos. A imagem da agenda foi editada pela ferramenta para adicionar nomes fictícios; conversão para WebP preserva a imagem. A fotografia mista representa um salão integrado com serviços de cabelo, manicure e ambiente de tratamento ao fundo. Originais permanecem no diretório de imagens geradas do Codex.

Testes de preferência de segmento, temporização, cadastro, segurança do onboarding e recuperação de senha: 21 testes em cinco arquivos aprovados. A verificação de navegador foi ampliada para incluir o tema misto, transferência dos seis segmentos ao cadastro, navegação entre telas do aplicativo e tabela de preços. Relatório atualizado em `artifacts/refinement-v3/verification.json`.

A revisão final também direciona a navegação Recursos para a nova apresentação de funcionalidades, oferece ampliação da agenda em nova aba e aumenta o contraste dos textos sobre a atmosfera e do fechamento misto. A imagem refinada da agenda pesa 89.842 bytes e a fotografia mista, 176.444 bytes.

Validação completa da revisão: 184 checagens de navegador aprovadas, 13 auditorias automatizadas de acessibilidade sem violações e nenhum erro de execução nas páginas monitoradas. Cobertura de 320, 360, 390, 768, 1024 e 1440 px, seis segmentos, movimento reduzido, vídeo, camadas ao scroll, cadastro contextual, aplicativo e preços. Auditorias automáticas não substituem avaliação humana; capturas também foram revisadas visualmente. Essa revisão visual identificou o ícone do menu móvel misto com cor herdada escura, corrigido para acompanhar a cor clara do cabeçalho. Verificação específica adicional em `scripts/verify-mixed-menu.mjs`.

Compilação final, lint e tipos aprovados após o ajuste. A verificação adicional do menu passou em 320 px, incluindo contraste do ícone, abertura, navegação para Recursos, fechamento, limites da tela e uma 14ª auditoria de acessibilidade sem violações. Evidências em `artifacts/refinement-v3/menu-verification.json` e `verified-mixed-menu-320.png`. A prévia permanece local em http://127.0.0.1:3001; nenhuma publicação foi executada.

## Preparação da publicação autorizada

O responsável autorizou atualizar a branch no GitHub, realizar o merge e publicar em produção em 05/09/2026. A suíte completa passou com 123 arquivos e 625 testes. A auditoria de dependências identificou os avisos GHSA-c83g-rgw3-j3cx e GHSA-73wf-gq98-2v4g no Browserslist 4.28.6; o lockfile foi atualizado para 4.28.9 e sua base de navegadores, e a auditoria passou sem vulnerabilidades. Nenhuma dependência direta ou regra de autenticação foi alterada. O rollout deve aguardar CI e Preview; banco e variáveis remotas permanecem fora do escopo.
