# Landing, login e criação de estabelecimento — revisão ScrollCraft

Implementação local na branch `codex/premium-landing-login`, em 05/09/2026. Substitui a primeira proposta documentada em `docs/LANDING_PREMIUM_2026-09-05.md`. Sem publicação, push ou alteração do banco.

## Experiência implementada

A abertura tem arquitetura, vídeo de luz, fotografia, vidro transparente, tipografia e faixa de saída em planos separados. O scroll nativo aproxima a foto, afasta o primeiro plano e recua a headline. A assinatura é a abertura de um espaço, seguida da apresentação do sistema em uma cena independente. Não há captura de agenda sobre a foto do estabelecimento.

Barbearia muda toda a apresentação para preto/grafite: fundos, iluminação, vidro, saturação das imagens, contraste, botões e navegação. Os outros segmentos usam marfim, pedra e tons neutros quentes. A preferência acompanha login e cadastro sem alterar o segmento cadastral automaticamente.

Quatro famílias de interação: hero com profundidade e oclusão; aproximação em perspectiva da imagem do produto; palavras destacadas conforme o scroll; cartões de recursos sobrepostos em desktop/tablet. Mobile possui composição própria, deslocamentos menores e recursos em fluxo normal. Não há rolagem forçada, biblioteca 3D ou renderização WebGL em tempo real no site.

Troca automática a cada oito segundos. Seleção manual tem intervalo mínimo de dezesseis segundos. Foco, hover, aba oculta, cena fora da tela e pausa explícita suspendem a troca. O vídeo pausa fora da cena e com a pausa explícita. `prefers-reduced-motion` inicia sem alternância automática, não baixa vídeo e remove o pin e deslocamentos. A seleção manual continua disponível; a alternância pode ser ativada explicitamente.

O cadastro agora tem duas áreas visuais: negócio e acesso. `/signup` e `/onboarding/create-salon` usam o mesmo shell editorial. Campos, serviços sugeridos, handlers, ações, validações, autenticação e guards existentes foram preservados; o erro local de confirmação de senha agora é anunciado. O plano Grátis permite acesso imediato, confirmado no código. Corrigida a informação incorreta da primeira landing sobre aprovação obrigatória.

## Referências estudadas

- [AI Automation Society](https://aiautomationsociety.ai/): capturas em quatro posições e inspeção das camadas sky/ridge/device/floor. Base principal para planos, oclusão e resolução da cena. Não copiamos montanhas nem assets.
- [ScrollCraft](https://github.com/nateherkai/scroll-craft): briefing de oito decisões, contrato de camadas, hero-depth, devices, approved collection e adaptação ao React existente. Decisões anteriores à implementação em `BRIEF.md`.
- [21st.dev — hero examples](https://21st.dev/blog/react-hero-section-examples), [scroll video hero](https://21st.dev/community/components/explore/nt-scroll-video-hero-prompt) e catálogo de shaders: expansão de mídia, acabamento de controles e movimento ambiente. Componentes próprios, sem copiar código de registry ou adicionar dependências.
- [Godly — hero](https://godly.design/hero/) e [Vessa](https://vessa.design/), encontrada na curadoria: inspeção visual da hierarquia de headline, CTA, controle segmentado e grande superfície de conteúdo. Adaptada a separação entre promessa e mídia; não usamos seu azul, identidade ou prova social.
- Booksy, Agendali, Trinks e Avec: levantamento anterior preservado no documento histórico. Funcionalidades anunciadas conferidas no repositório. Sem clientes, depoimentos, estatísticas ou automação comercial inventados.

## Verificação

- `npm run build`: aprovado, incluindo lint e tipos. Home: 9,4 kB de rota; 121 kB de JS inicial informado pelo Next. Esses números não equivalem a uma pontuação de Lighthouse nem medem redes móveis reais.
- `npm run lint` e `npm run typecheck`: aprovados.
- Testes direcionados de preferência, rotação, signup, segurança do onboarding e recuperação de senha: 5 arquivos, 20 testes aprovados.
- `node scripts/verify-scrollcraft.mjs`: 123 checagens, nove auditorias axe sem violações, nenhum erro de execução em Chrome. Resultado confirmado tanto em desenvolvimento quanto novamente na versão otimizada de produção. Viewports 1440×1000, 1024×768, 768×1024, 390×844 e 360×740. Inclui cinco segmentos, ausência de overflow, alvos de toque, profundidade, navegação, reprodução/pausa real do vídeo, cadastro sem envio e movimento reduzido.
- Capturas e relatório detalhado em `artifacts/scrollcraft-v2` (ignorados pelo Git). Avaliação visual de entrada, meio, saída, login e cadastro. Corrigidos espaço vazio durante o pin, legenda desalinhada e tamanho dos controles móveis.
- Não houve criação real de conta ou login com banco; ações e guards foram preservados e cobertos pelos testes existentes. Safari/iOS e Android físicos ainda não foram testados. Sem afirmação de conformidade total baseada apenas em axe.

## Assets e reprodução

Prompts, arquivos e transparência documentados em `ASSETS.md`. O vídeo ambiente pesa cerca de 574 kB e é reproduzido como arquivo local. Geração pode ser repetida com `node scripts/render-ambient-video.mjs`, usando Chrome e Playwright. A imagem conceitual da agenda é explicitamente rotulada como diferente da interface atual. O módulo interno `/agenda` não foi modificado nesta revisão.

Prévia: iniciar a aplicação local na porta 3001. `scripts/verify-marketing.mjs` encaminha para a verificação atual. Os scripts usam apenas a prévia local para formulários e não enviam dados ao banco.
