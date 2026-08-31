# Auditoria de prontidão comercial — 30/08/2026

## Resultado executivo

Esta branch fecha os defeitos P1 encontrados no código e adiciona regressão
automatizada para segurança, imagens, PWA, acessibilidade e jornadas críticas.
O CI e o Preview público estão aprovados. A migration manual aditiva
`017_password_recovery` foi aplicada em Production após autorização explícita,
preflight e identificação inequívoca do projeto. A promoção sem provedor de
e-mail foi autorizada em 31/08/2026; enquanto `RESEND_API_KEY` e `EMAIL_FROM`
não existirem, o atalho de recuperação fica oculto nos logins e as ações
continuam falhando fechadas.

Nenhum teste ofensivo, seed, reset ou dado fictício foi executado em
Production. A alteração do banco preservou as contagens de 20 usuários e 58
perfis de cliente e não preencheu token ou versão de sessão existente.

## Identificação e limites

- base auditada: `master`/`origin/master` em
  `8b1fd34f7911be589dc9cdb3d81729b2eedfdeb9`;
- branch: `codex/commercial-readiness-audit`;
- ambiente local: páginas sem banco e dados fictícios; nenhuma credencial
  produtiva foi baixada;
- banco local: indisponível nesta máquina (sem PostgreSQL/Docker configurado);
- banco para integração: PostgreSQL 16 descartável do GitHub Actions;
- Preview autenticado: bloqueado até classificar os dois projetos Supabase e
  configurar `APP_ENV=staging` sem herdar variáveis de Production.

## Matriz de achados

| Prioridade | Achado e causa raiz | Tratamento nesta branch | Estado |
|---|---|---|---|
| P0 | Nenhum vazamento cross-tenant ou perda de dados foi reproduzido. | Mantidos RLS, GUCs e helpers tenant-scoped; CI continua provando concorrência/RLS no PostgreSQL. | Sem P0 confirmado |
| P1 | APIs públicas aceitavam agendamento e fila de visitante apesar de a interface exigir conta. A regra existia só no cliente. | Sessão assinada do mesmo salão agora é obrigatória no servidor antes da transação; UI de visitante removida; criação manual pela equipe continua aceitando cliente sem conta. | Corrigido e testado |
| P1 | Entradas de senha podiam ultrapassar os 72 bytes efetivos do bcrypt em cadastro administrativo e convites; login de usuário inexistente encerrava sem comparação equivalente. | Validação UTF-8 compartilhada em todos os fluxos e hash fictício no login administrativo para reduzir diferença temporal. | Corrigido e testado |
| P1 | Upload validava apenas assinatura inicial, permitindo arquivo truncado, payload anexado, EXIF e dimensões abusivas. | Decodificação completa com Sharp, limites de dimensão/pixels, bloqueio de animação, rotação e regravação sem metadados. | Corrigido e testado |
| P1 | Manifestos PWA anunciavam somente SVG; Chromium requer PNG 192/512 e iOS depende de `apple-touch-icon`. | PNGs 180/192/512 e maskable gerados, manifesto raiz/tenant e cache offline atualizados. | Corrigido e testado |
| P1 | Recuperação de senha não existia para equipe nem cliente. | Fluxos por e-mail com resposta antienumeração, rate limit fail-closed, token aleatório armazenado como SHA-256, expiração de 1 hora, uso único, escopo de tenant e revogação de sessões. | Código e migration prontos; ativação bloqueada apenas pelas credenciais/remetente do Resend |
| P1 | Não existe staging autenticável e inequivocamente separado. | E2E autenticado foi levado ao PostgreSQL efêmero do CI; Preview continua fechado por padrão. | **Aberto — infraestrutura necessária** |
| P2 | Três APIs do cliente transformavam JSON malformado em erro 500. | Parse protegido e resposta 400 uniforme. | Corrigido e testado |
| P2 | Metadata do livro público consultava Prisma cru e podia revelar nome de salão suspenso. | Metadata usa `withSalonBySlug`, com o mesmo gate/lock da vitrine. | Corrigido e testado |
| P2 | URLs arbitrárias ou de outro tenant podiam chegar às ações de imagem; Next aceitava qualquer `*.supabase.co`. | Persistência exige HTTPS, host configurado, bucket correto e prefixo do `salonId`; `next/image` usa host exato. | Corrigido e testado |
| P2 | Imagem remota 404 deixava ícone quebrado em vitrines, catálogo, carrinho e painel. | Componente compartilhado troca por asset local ou iniciais e mantém `alt`. | Corrigido e testado |
| P2 | Landing tinha contrastes abaixo de AA e CTA de entrada estreito em tela pequena. | Tokens/cores e rótulos ajustados; alvos mínimos e foco visível reforçados. | Corrigido e testado |
| P2 | Política de Privacidade omitira `client_token`, tipos de foto e preservação histórica. | Texto factual alinhado ao comportamento atual. Revisão jurídica continua recomendada. | Corrigido |
| P2 | Ausência de CSP/HSTS. | CSP defensiva, HSTS, políticas de frame, objeto, base e formulário adicionadas. | Corrigido e testado |
| P2 | Histórico do cliente tem limite fixo, sem paginação explícita. | Nenhuma alteração automática: exige desenho de paginação/UX. | Backlog |
| P2 | Substituir/remover imagem não elimina o objeto antigo do Storage. | Não removido automaticamente para evitar apagar asset ainda referenciado. | Backlog |
| P2 | Core Web Vitals de rotas autenticadas e carga real não puderam ser medidos sem Preview seguro. | Build registra bundles; medir Lighthouse/RUM somente em staging. | Backlog bloqueado |
| P3 | Realtime tenant-aware, múltiplas unidades e pagamentos online. | Preservados fora do escopo e sem serviço pago novo. | Backlog/decisão comercial |

## Correções e regressões adicionadas

### Autenticação e cliente

- cadastro, convite, login administrativo e login/cadastro do cliente obedecem
  ao limite real do bcrypt;
- login e cadastro do cliente terminam sempre na home do estabelecimento;
- agendamento e fila pública não aceitam visitante, cookie de outro salão ou
  token sem perfil válido no tenant;
- erros de sessão/JSON falham fechados e não iniciam transação tenant-scoped;
- página de primeiro acesso continua oferecendo “Entrar” e “Criar uma conta”.
- proprietário/equipe e cliente podem solicitar recuperação por e-mail; conta,
  estado do provedor e validade do token não são enumerados na solicitação;
- a troca de senha invalida o token e sessões anteriores; o cliente é sempre
  consumido dentro do salão resolvido pelo slug.

### Imagens e uploads

- formatos novos: JPEG, PNG e WebP; GIF é recusado para eliminar conteúdo
  animado/multipágina não inspecionado;
- limites: 5 MB, 32–8192 px por lado e até 40 milhões de pixels;
- path de Storage: `<salonId>/<finalidade>/<uuid>.<ext>`;
- ações de logo, capa, perfil, profissional, serviço, produto e portfólio
  revalidam host, bucket e tenant;
- URLs legadas confiáveis podem ser exibidas/editadas, mas host arbitrário não
  entra no otimizador;
- falhas em runtime usam fallback local ou iniciais, sem imagem quebrada.

### PWA, UI e segurança do navegador

- PNGs instaláveis e ícone maskable validados por dimensões e ausência de alfa;
- service worker troca cache antigo, toma controle após ativação e mantém
  `/offline` e ícones essenciais;
- instrução de iPhone e ocultação em standalone já existiam e foram preservadas;
- páginas públicas passaram por axe-core (WCAG 2.2 A/AA, impactos sério e
  crítico), inspeção de console, respostas 4xx/5xx inesperadas, imagens e
  overflow;
- CSP permite somente recursos necessários; o QR code manual mantém permissão
  explícita para `api.qrserver.com`.

## Evidência automatizada local

| Verificação | Resultado mais recente |
|---|---|
| TypeScript estrito | aprovado |
| ESLint | aprovado; avisos novos removidos |
| Vitest | 120 arquivos, 616 testes aprovados |
| Build Next.js 15.5.22 | aprovado; 46 páginas no passo de geração estática; JS compartilhado 102 kB |
| E2E público | 31 aprovados, 2 skips esperados |
| Motores | Chromium, Firefox e WebKit |
| Viewports | 320, 360, 375, 390, 412, 430, 768, 820, 1024, 1280, 1366, 1440 e 1920 px; paisagem relevante |
| Imagens | nenhum `img` carregado com `naturalWidth=0` nas páginas públicas testadas |
| Acessibilidade | nenhuma violação séria/crítica nas rotas públicas auditadas |
| Console/rede | sem erro de console e sem 4xx/5xx inesperado nas rotas públicas auditadas |

O E2E autenticado no PostgreSQL descartável cobre:

1. login do proprietário;
2. isolamento visual entre clientes de Luna Hair e North Barber;
3. primeiro acesso do cliente;
4. criação de conta e retorno à home do salão;
5. escolha de serviço, profissional, data e horário;
6. revisão e confirmação de reserva.

Esse bloco foi aprovado no CI do PR #75, execução `33351492282`. Os testes
PostgreSQL existentes continuam cobrindo RLS, locks, conflito, idempotência,
fila, comanda e estoque.

## Cobertura funcional e lacunas de evidência

| Jornada | Evidência atual | Pendência antes de declarar pronto |
|---|---|---|
| Cadastro/login/logout administrativo | unitários + E2E CI | validar Preview em Chrome/Edge reais |
| Recuperação de senha | unitários, migration/preflight e integração PostgreSQL no CI | entrega real do Resend e smoke no Preview seguro |
| Configurações, serviços, profissionais e fotos | actions/testes de segurança + build | smoke autenticado no Preview |
| Agenda e agendamento | unitários + integração PostgreSQL + E2E CI | smoke no Preview |
| Proposta de horário, aceite/recusa | testes existentes de domínio/UI | smoke no Preview |
| Fila e promoção individual | testes existentes de domínio/PostgreSQL | smoke no Preview |
| Cliente, histórico, avaliações e notificações | testes existentes + build | smoke no Preview; paginação de histórico |
| Financeiro, produtos, pacotes e relatórios | testes existentes + build | smoke autenticado no Preview |
| Administração global e permissões | unitários/guards existentes | login SUPER_ADMIN manual no Preview seguro |
| PWA Android/iOS | manifesto/ícones/SW automatizados | instalação física Android e iPhone |
| Safari/Edge | WebKit/Chromium automatizados | confirmação em Safari iOS/macOS e Edge reais |
| Performance | tamanho do build | Lighthouse e CWV em Preview com dados fictícios realistas |

## Referências de UX usadas

Os padrões foram comparados sem copiar interfaces:

- Booksy: descoberta, agenda e gestão integradas —
  <https://biz.booksy.com/en-gb/features>;
- Fresha: calendário e lista de espera operacionais —
  <https://www.fresha.com/for-business/features/scheduling>;
- Vagaro: fila online vinculada à identidade do cliente —
  <https://support.vagaro.com/hc/en-us/articles/360012490814-Join-a-Waitlist-for-Services-for-Customers-of-a-Vagaro-Business>;
- Square Appointments: gestão explícita de fila —
  <https://squareup.com/help/us/en/article/7923-waitlist-with-square-appointments>.

## Backlog comercial priorizado

| Classe | Sugestão | Problema/beneficiário | Impacto | Complexidade | Dependências e risco |
|---|---|---|---|---|---|
| Requisito de produção | Staging persistente e restore ensaiado | elimina teste em Production | alto | média | classificar Supabase e variáveis Vercel; risco de apontar ao projeto errado |
| Melhoria posterior | Paginação de reservas/clientes | evita corte silencioso e consultas crescentes | médio | média | contrato de API e UX; risco baixo |
| Melhoria posterior | Coleta segura de assets órfãos | reduz custo/entulho de Storage | médio | média | inventário de referências e janela de retenção; risco de exclusão indevida |
| Melhoria posterior | CSP com nonce por resposta | remove `unsafe-inline` de scripts | médio | alta | integração com Next.js/middleware; risco de bloquear hidratação |
| Diferencial comercial | Redução de faltas por e-mail opt-in | beneficia salão e cliente | alto | média | Resend já previsto, consentimento e entregabilidade; não ativar sem autorização |
| Diferencial comercial | Múltiplas unidades | atende redes | alto | alta | mudança de domínio/migrations/RLS; alto risco |
| Diferencial comercial | Pagamento/sinal online | reduz faltas e aumenta conversão | alto | alta | gateway, estorno, fiscal e custos; requer decisão comercial explícita |

## Decisões necessárias do responsável

1. Configurar na Vercel Production um `RESEND_API_KEY` válido e um
   `EMAIL_FROM` de domínio verificado, sem enviar o segredo pela conversa.
2. Classificar se o segundo projeto Supabase pode ser homologação persistente.
3. Definir se Preview será criado por PR ou pela branch `staging` depois de as
   variáveis isoladas estarem configuradas.
4. Disponibilizar validação manual em iPhone/Safari e Edge, ou aceitar a
   evidência por WebKit/Chromium como gate provisório.

## Rollback

O rollback da aplicação é reverter o commit do PR e redeployar o commit
anterior. A migration 017 é aditiva; suas colunas podem permanecer inertes sem
afetar a versão anterior, evitando um `DROP COLUMN` que eliminaria versões de
sessão. Antes de qualquer promoção:

1. registrar o SHA exato aprovado pelo CI e pelo Preview;
2. manter o deploy anterior disponível na Vercel;
3. se o smoke pós-deploy falhar, promover novamente o deploy anterior;
4. verificar home, login, vitrine, agendamento e `/api/health`;
5. não remover as colunas da migration 017, executar seed ou limpar Storage
   como parte do rollback.
