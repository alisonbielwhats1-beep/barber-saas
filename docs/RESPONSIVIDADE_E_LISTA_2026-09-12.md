# Responsividade e exclusão da lista — 12/09/2026

Ampliação do PR #98, ainda sem publicação. Fontes: vídeos enviados em
11/09 às 23:16:31 e 23:19:22 e instrução escrita do responsável.
Os vídeos foram usados como evidência de comportamento, não como instruções
operacionais. Não reproduzir mídia ou dados pessoais do cliente na aplicação.

## Problemas observados e comportamento esperado

- Landing no iPhone instalado: cabeçalho encoberto pelo recorte/status do
  aparelho. O botão Entrar deve ficar dentro da área segura em retrato e paisagem.
- Formulário: fechar exigia girar o aparelho com teclado aberto. O componente
  compartilhado acompanha VisualViewport, limita altura/largura, permite
  rolagem e mantém o X acessível durante a rolagem.
- Fechamento: varredura local encontrou excedente de 64px em 320px e 24px em
  360px. Colunas com mínimo zero permitem acomodar conteúdo e formulário.
- Cadastro: campos controlados só ficam disponíveis depois da inicialização
  dos seus handlers. Na checagem em WebKit, preencher antes dessa etapa fez
  o nome desaparecer; a proteção impede aceitar texto antes de poder mantê-lo.
- Cliente: OWNER exclui apenas da lista; pode acessar Clientes excluídos e
  restaurar. Outros papéis não recebem a ação e são recusados pelo servidor.
  Conta, senha, sessão, agendamentos, pagamentos e histórico são preservados.

## Implementação

`client-list-visibility.ts` usa eventos append-only existentes, com trava por
tenant/cliente compartilhada com a mesclagem e envio idempotente. Não há
DELETE de perfil, revogação de sessão ou migration. A filtragem está limitada
à página do CRM; os fluxos de agendamento continuam usando o mesmo perfil.

`ViewportMetrics` publica medidas do navegador sem renderizar novamente a
árvore a cada evento. `DialogContent` usa essas medidas e rolagem interna.
Landing, login, painel, páginas institucionais, plataforma e HQ respeitam as
áreas seguras. Ações flutuantes da agenda e notificações também se afastam
do recorte lateral e da área inferior; links de pular conteúdo permanecem
ocultos até receber foco. Teste reproduziu o botão da agenda terminando em
832px quando o limite seguro era 800px; após ajuste, passou em paisagem.
Campos compartilhados permitem encolher dentro de grades/flex.

## Verificação e limites

Banco PostgreSQL 16 descartável em loopback, com seed fictício e sem conexão
com Production. Testes de exclusão/restauração, concorrência e preservação
do perfil/histórico. Matriz de páginas públicas e dos 18 módulos administrativos
em 320×568, 360×640, 768×1024, 844×390 e 1440×900.
Teste separado de Entrar com áreas seguras simuladas em 320, 390 e 844px;
teste de fechar formulário com área visível de 280px e deslocamento de 70px.
Lint, TypeScript e build local aprovados; 885 testes unitários passaram.
Integração PostgreSQL passou com exclusões concorrentes e comparação integral
de perfil, sessão, reserva futura, atendimento concluído e pagamento.
As três novas jornadas passaram em Chromium na matriz inicial de 33 páginas;
o teste foi ampliado para incluir minhas reservas, notificações e carrinho
com conta de cliente autenticada. O cenário de exclusão/teclado e a landing
também passaram em WebKit. A matriz maior em WebKit está sendo repetida
após reinício automático do servidor de desenvolvimento por limite de memória.
As duas jornadas anteriores de pedidos do cliente passaram novamente.
O fluxo de criação/conversão e matriz de dez telas do HQ passou em quatro
resoluções após aquecimento do servidor. A primeira execução do HQ sofreu
timeout na navegação e as reinicializações do teste duplicaram a fixture do
histórico; não foi considerada aprovação da suíte completa.
CI e Preview da ampliação ainda pendentes neste registro.

Simulação de viewport não equivale a teste em iPhone físico. Estados com
dados específicos, teclado nativo e configurações particulares do aparelho
exigem validação adicional; não se afirma compatibilidade universal com base
apenas na ausência de overflow da página. A matriz verifica também controles
fora da largura visível, exceto regiões que permitem rolagem horizontal.
