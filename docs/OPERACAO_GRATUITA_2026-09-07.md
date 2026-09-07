# Operação gratuita — disponibilidade, recuperação e verificações

Solicitação: executar as medidas gratuitas e deixar contratações para depois.
Nenhuma compra, upgrade, cartão ou serviço pago é necessário nesta entrega.

## Disponibilidade

`.github/workflows/availability.yml` consulta somente o endpoint público
`https://salon-saas-ruby.vercel.app/api/health`. Não autentica, não grava dados
e não usa credenciais do banco ou da Vercel. O endpoint exige aplicação e banco
saudáveis; HTML, redirecionamento, JSON inválido e erro HTTP não contam como sucesso.

- Intervalo solicitado de cinco minutos, fora do minuto zero.
- Três tentativas com timeout de dez segundos e pausa entre tentativas.
- Abre uma issue com menção ao responsável `alisonbielwhats1-beep` após falha
  persistente, sem repetir issues/comentários enquanto a falha continua.
- Fecha a issue automaticamente na recuperação, preservando o histórico.
- Relatórios só contêm estado, motivo padronizado e link da execução.
- Falhas do job também aparecem no GitHub Actions. Recebimento por e-mail depende
  das preferências de notificações da conta; não equivale a entrega confirmada.

Este monitor é básico e sem SLA. O GitHub pode atrasar/descartar execuções em
picos e desativa schedules após 60 dias sem atividade em repositórios públicos.
Consultar periodicamente a última execução; se desativado, reativar no Actions.
Não é monitoramento contínuo de latência, erros internos, cron, Storage ou e-mail.
UptimeRobot não foi configurado: esta entrega aproveita a conta GitHub existente.

Fontes: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
e https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs.

## Recuperação de senha por e-mail

O código e a migration 017 já existem e passaram por testes de expiração,
uso único, revogação de sessão, isolamento de estabelecimento e falha de envio.
Não reaplicar a migration nem redefinir senhas produtivas para testar.

Nesta sessão, o responsável informou que ainda não possui domínio. A conta
Resend conectada no navegador não tem domínio cadastrado. Portanto, o envio real
de recuperação permanece pendente: não configurar um remetente fictício nem
ativar `onboarding@resend.dev` para clientes. O domínio de teste só envia ao
endereço da conta Resend. Não foi criada chave nem ativado envio produtivo.

Quando houver domínio:

1. Adicionar e verificar no Resend com os registros DNS fornecidos pelo serviço;
   preservar registros MX existentes do correio. Usar subdomínio dedicado ao envio.
2. Criar chave com permissão de envio limitada ao domínio; cadastrar diretamente
   na Vercel como `RESEND_API_KEY`, sem copiar para Git, chat ou logs.
3. Configurar `EMAIL_FROM` com remetente verificado e conferir `NEXTAUTH_URL`
   com HTTPS/domínio oficial. Preview não deve receber chave/banco produtivos.
4. Validar entrega usando os destinatários de teste documentados pelo Resend
   e a jornada com dados sintéticos em ambiente isolado. Só então ativar o runtime.
5. Conferir a exibição de “Recuperar por e-mail” no painel e no acesso do cliente.

O plano gratuito oferece 3.000 e-mails/mês, máximo de 100/dia. Atingir limite
exige tratamento operacional; não habilitar upgrade ou campanha automaticamente.

Fontes: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain,
https://resend.com/docs/dashboard/domains/introduction e https://resend.com/pricing.

## Demais medidas gratuitas

- Auditoria semanal das dependências produtivas pelo `npm audit`; vulnerabilidade
  alta/crítica causa falha no Actions. Não atualiza pacotes automaticamente.
- Ensaio no CI de backup/restauração do schema atual completo com dados sintéticos,
  comparando quantidade e hash de todas as tabelas públicas. Complementa os ensaios
  anteriores das migrations 018/019 e não acessa Production.
- Testes existentes de navegador, responsividade, acessibilidade, recuperação de
  senha e concorrência permanecem nos gates do CI.
- Os workflows usam runners Linux padrão do repositório público. Se a visibilidade
  ou o tipo de runner mudar, revisar gratuidade/cotas antes de mantê-los ativos.

Esse ensaio sintético não substitui backup recorrente do banco real e das fotos.
Nenhum backup produtivo foi copiado para ambiente de teste. Ainda falta definir
destino privado, retenção, criptografia e recuperação das cópias produtivas.
Validação em iPhone/Android físicos e capacidade sob carga realista seguem pendentes.

## Procedimento de incidente

Responsável inicial: proprietário do projeto, `alisonbielwhats1-beep`.

1. Abrir a issue e a execução citada; confirmar se é falha da aplicação, banco
   ou do próprio GitHub. Consultar `/api/health` e status da Vercel/Supabase.
2. Consultar logs da implantação e mudanças recentes. Não publicar nomes,
   contatos, tokens, senhas, strings de conexão ou respostas completas em issues.
3. Se a falha começou após um deploy, avaliar retorno ao deployment anterior
   comprovadamente saudável. Não executar migration inversa, seed ou reset.
4. Se for banco, preservar escritas e investigar conectividade/cotas. Restauração
   de backup exige identificar destino, preservar dados novos e autorização.
5. Confirmar recuperação da sonda e páginas públicas; registrar causa e ação
   sanitizadas na issue. A checagem automática encerra o incidente de disponibilidade.

## Validação e ativação

`node --test scripts/health-monitor.test.mjs` simula falha/retorno sem desligar
Production ou abrir incidente falso. Lint, TypeScript, Vitest, build e CI
validam a entrega. Após o merge, executar manualmente os dois workflows e
confirmar uma execução do schedule. Resultados por commit no PR desta entrega.
