# Landing e login: direção e evidências

Registro histórico da primeira proposta. A revisão vigente está em [ScrollCraft v2](scrollcraft-v2/IMPLEMENTACAO.md). Os resultados e decisões abaixo descrevem a versão anterior, substituída após o feedback do usuário. Branch local: `codex/premium-landing-login`.
Base: repositório clonado de `origin/master` em 05/09/2026. Nenhuma alteração remota autorizada nesta etapa.

## Análise antes da implementação

- Next.js 15.5, React 18, Tailwind/Radix; autenticação Credentials/NextAuth com JWT e callback sanitizado.
- A home compõe `animated-landing`, `segment-explorer`, `landing-mobile-showcase` e planos centralizados em `plan-entitlements`.
- Existem dois estados independentes de segmento. O hero gira automaticamente a cada 5,5 segundos e retoma a rotação após uma escolha, enquanto o seletor seguinte não altera a página.
- O modo escuro atual só afeta o hero. Cores fixas nas outras seções fragmentam a identidade.
- A home usa representações de dashboard e celulares desenhadas em HTML. Não são capturas do ERP. A nova versão deve usar o componente real em captura local, com dados de demonstração identificados.
- A página repete títulos centralizados e grades de cartões, reduzindo a hierarquia entre promessa, demonstração e decisão.
- Login usa `AuthShell`, compartilhado com outras jornadas. A reconstrução deve ter um shell exclusivo para o login para evitar alterações involuntárias em cadastro e recuperação.
- O formulário existente preserva `signIn`, sanitização de callback, mensagens de erro, estado de carregamento e redirecionamento. A recuperação de senha continua condicionada à configuração existente.

## Produto confirmado

Agenda dia/semana/mês/lista, histórico de clientes, profissionais, serviços, financeiro, despesas, relatórios, comissões, produtos/estoque, pacotes, portfólio, notificações internas e vitrine/agendamento online estão documentados e implementados. Planos e limites vêm de `src/lib/plan-entitlements.ts`.

Não anunciar pagamentos online, automação de WhatsApp, IA, múltiplas unidades, estatísticas de crescimento, clientes ou depoimentos sem evidência. Correção confirmada na revisão: o plano Grátis cria o estabelecimento aprovado e libera o acesso imediatamente. Upgrades têm tratamento separado.

## Referências e posicionamento

Consulta em 05/09/2026:

| Fonte | Observação verificável | Princípio a adaptar |
|---|---|---|
| [Booksy](https://biz.booksy.com/pt-br) | Agendamento e fidelização; sequência configurar, compartilhar link, receber agendamentos | Explicar o primeiro uso e mostrar o produto |
| [Agendali](https://www.agendali.com.br/) | Dor direta da rotina no WhatsApp; linguagem simples | Promessa compreensível antes dos detalhes |
| [Trinks](https://negocios.trinks.com/) | Segmentos e gestão abrangente, da agenda às finanças | Reconhecimento do tipo de negócio e clareza operacional |
| [Avec](https://negocios.avec.app/avec-planos) | Atendimento, equipe e financeiro conectados; planos por tamanho da operação | Contar a operação como um fluxo, não uma lista de ferramentas |
| [21st.dev](https://21st.dev/) | Catálogo de componentes, apresentação de interfaces e exemplos de estados | Hierarquia, acabamento de controles e produto como evidência; sem copiar blocos |
| [ScrollCraft](https://github.com/nateherkai/scroll-craft) | Jornada, pico único, planos de profundidade, estados inicial/intermediário/final, mobile e redução de movimento | Transformação coordenada de atmosfera e narrativa de scroll curta |

O site publicado foi bloqueado pelo Cloudflare Gateway da rede corporativa. Isso limita a auditoria da produção, não prova defeito do aplicativo. Motionsites e vídeo do YouTube não puderam ser recuperados pela consulta web; não atribuir detalhes visuais a conteúdo não observado.

## Brief

Self-authored under explicit creative delegation. O usuário delegou textos, estrutura, imagens e motion; definiu o pico Light → Dark ao selecionar Barbearia.

- Público: salões, barbearias, manicure, estética e massagem/bem-estar.
- Crença final: posso organizar minha operação neste sistema e reconhecer meu negócio nele.
- Personalidade: calma, precisa, contemporânea e acolhedora.
- Sequência: reconhecer o negócio → experimentar sua atmosfera → entender a rotina conectada → comparar planos → criar conta.
- Energia: começo claro, transformação marcante por escolha, explicação serena e encerramento seguro.
- Pico: “É o site que muda de ambiente quando escolho minha barbearia.”
- Gramática: editorial com demonstração do produto e controle persistente de atmosfera. Sem filme contínuo, catálogo, pôster tipográfico, comparação em duas colunas ou cortes rápidos; essas estruturas atrapalhariam clareza e conversão neste SaaS.
- Ação principal: Criar meu espaço. Secundária: Conhecer o sistema, âncora para a demonstração.
- Assets: cinco fotografias editoriais novas, geradas para esta identidade e exportadas em WebP (583.426 bytes no total). Não representam clientes ou depoimentos. Capturas da agenda real nos dois temas com registros sintéticos identificados. Sem vídeo ou dependência de animação adicional.
- Identidade: manter SalonSaaS; tons minerais claros, verde profundo; grafite e verde mineral no escuro. Duas funções tipográficas, espaçamento fluido e controles de pelo menos 44 px.

## Jornada e motion

| Momento | Sentimento | Tratamento |
|---|---|---|
| Abertura | Reconhecimento | Headline legível, fotografia e escolha de segmento |
| Escolha | Pertencimento; pico | Fundo, luz, fotografia, controles, acento e captura real mudam juntos; métricas tipográficas estáveis evitam deslocamento |
| Operação | Clareza | Conteúdo em capítulos e captura real estável; progresso por scroll nativo |
| Planos e dúvidas | Confiança | Preços da fonte de verdade e respostas concretas sem efeitos contínuos |
| Encerramento | Prontidão | CTA simples e identidade escolhida preservada até login |

Planos visuais: ambiente mineral, fotografia em plano intermediário, superfície real do produto em primeiro plano; texto e controles estáveis. Sem recortar pessoas ou simular dashboards. Movimento por transform/opacity, sem scroll hijacking. Dispositivos móveis recebem composição empilhada e seletor que cabe na tela. Reduced motion remove deslocamentos e encurta mudanças de estado, sem esconder informação.

ScrollCraft é aplicado como metodologia adaptada ao React existente. O preflight detectou ausência de FFmpeg completo; não há vídeo/scrubbing nesta proposta. Não instalar pipeline de geração desnecessário. Registro de fingerprints inicial vazio, sem trabalhos anteriores a comparar.

## Implementação

- Componentes em `src/components/marketing`; estilos limitados à apresentação pública. As rotas `/` e `/login` usam a nova identidade. Cadastro, recuperação e ERP interno mantêm seus fluxos.
- Um único seletor por página, sem rotação automática. A escolha é salva em `sessionStorage` e acompanha a navegação para o login. Não altera segmento cadastral, tenant, plano, permissões ou callback.
- Controles interativos aguardam a hidratação, evitando perder cliques em carregamentos lentos. Falhas ou dados inválidos no armazenamento não impedem a seleção.
- Fotografias e capturas ficam montadas em camadas; transições por opacidade, luz, cor e transformações discretas. Scroll nativo com atualização por `requestAnimationFrame`; sem biblioteca adicional, vídeo, WebGL ou rolagem forçada.
- Menu móvel com Escape e retorno de foco, controles de toque, estados anunciados e foco visível. Campos do login usam 16 px no celular para evitar zoom automático.
- A composição móvel coloca a legenda fora da fotografia, preservando os rostos. A narrativa fica empilhada, sem painel fixo; reduced motion remove deslocamentos e abrevia a transição de atmosfera.
- A lógica de `login-form.tsx`, NextAuth, middleware, permissões, callbacks e banco não foi alterada.

## Origem das imagens e reprodução

`brand-salon.webp`, `brand-barber.webp`, `brand-manicure.webp`, `brand-aesthetics.webp` e `brand-wellness.webp`: imagens geradas nesta tarefa, 1536 × 1024, WebP qualidade 88. A apresentação usa otimização responsiva de `next/image`.

`product-agenda-light.webp` e `product-agenda-dark.webp`: screenshots do componente existente `src/app/(admin)/agenda/agenda-board.tsx`, renderizado com oito agendamentos sintéticos e cinco profissionais. Rótulos “Cliente exemplo” e “Profissional” evitam personificar dados reais. A página informa “Interface real / dados de demonstração”. Os valores da captura são exemplos da interface, não resultados comerciais.

Para atualizar as capturas, inicie um servidor local na porta 3001 e execute `node scripts/capture-marketing.mjs`. A fixture em `scripts/fixtures/agenda-capture.tsx` é copiada temporariamente para uma rota local protegida por `NODE_ENV`, removida ao terminar e não integra a entrega. Não executar build simultaneamente à captura. O script aceita somente localhost/127.0.0.1 e não faz operações no banco.

## Verificação

- Auditoria visual antes/depois registrada em `artifacts/marketing` (artefatos locais ignorados pelo Git).
- `npm run lint`: aprovado.
- `npm test -- --maxWorkers=2 --testTimeout=20000 --hookTimeout=20000`: **122 arquivos e 621 testes aprovados**. A execução inicial irrestrita de workers sobrecarregou o computador; a concorrência limitada concluiu sem falhas.
- Playwright/Chrome autorizado pelo usuário, executado novamente sobre a versão otimizada: **44 checagens aprovadas**, nos tamanhos 320×568, 360×640, 390×844, 768×1024, 1024×768 e 1440×1000, sem overflow horizontal.
- Axe: **zero violações nas oito análises** (desktop claro/escuro, login escuro, erro de credenciais, mobile claro/escuro, login móvel e login claro após recuperação). Verificação automatizada não equivale a uma certificação completa de acessibilidade.
- Nenhum erro JavaScript observado. Testados persistência entre páginas, cinco segmentos, menu por teclado, capítulos por scroll e redução de movimento.
- O teste de credenciais usa respostas locais simuladas, sem enviar senhas a um banco. **Login autenticado com banco não foi validado**, pois não há ambiente local/staging de dados configurado. Nenhum teste atingiu produção.
- `npm run typecheck`: aprovado. A primeira checagem após retirar a rota temporária encontrou tipos gerados antigos; o build regenerou esses artefatos e a checagem final passou.
- `npm run build`: aprovado, 46 páginas estáticas geradas. A landing está pré-renderizada: 8,08 kB específicos / 119 kB First Load JS. Login: 6,1 kB específicos / 134 kB First Load JS. Valores reportados pelo Next.js, não uma medição Lighthouse ou de usuários reais.
- Testes do seletor repetidos após o ajuste de hidratação: 3/3 aprovados.
- Movimento normal: interpolação de cor intermediária confirmada, estado final correto, Light → Dark → Light validado também no celular. Capturas inicial, intermediária e final em `artifacts/marketing`.

Prévia local da versão otimizada: `http://127.0.0.1:3001`, enquanto o servidor desta tarefa permanecer ativo. Login: `/login`. Para reproduzir as verificações, execute `node scripts/verify-marketing.mjs`; o resultado detalhado é gravado em `artifacts/marketing/verification.json`.

Nenhum push, merge ou deploy foi executado.
