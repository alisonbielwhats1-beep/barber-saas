# Cores operacionais e conta de apresentação

## Direção solicitada

O responsável rejeitou roxo dominante e fundos coloridos no painel. A revisão
usa grafite neutro no escuro e marfim/pedra no claro. Verde identifica controles
principais e próximo atendimento; azul identifica execução e volumes; âmbar,
confirmações pendentes e reposição; vermelho, horários ultrapassados que precisam
de revisão. Lilás permanece na marca e na seleção de navegação/calendário.

O nome Everflair volta ao menu expandido, com o símbolo isolado ao recolher.
O seletor de aparência fica no topo do menu e no cabeçalho móvel. A preferência
é aplicada antes da pintura, inclusive aos diálogos renderizados em portais.

## Implementação

- `src/app/globals.css`: tokens administrativos, superfícies neutras e controles
  verdes com contraste adequado em cada tema; sem mudar tokens públicos.
- `src/app/(admin)/admin-sidebar.tsx`, `layout.tsx`, `sidebar-footer.tsx`,
  `theme-provider.tsx`, `theme-toggle.tsx`: marca, posição e persistência do tema.
- `src/app/(admin)/dashboard/now-strip.tsx` e `page.tsx`: próximo horário indicado
  por texto, ícone e contorno verde; estados azul/âmbar/vermelho independentes da
  cor do serviço. O próximo horário é o mais próximo entre os cartões exibidos
  ainda não iniciados. Horário ultrapassado não altera status nem declara falta.
- Testes de prioridade temporal e navegação acessível em ambos os temas.
- `agenda/agenda-status.ts`, `agenda/agenda-board.tsx` e `hoje/hoje-view.tsx`:
  confirmado verde e em atendimento azul também na agenda, detalhes e tela Hoje.

Lint, TypeScript e 146 arquivos / 696 testes locais passaram. Conferência visual
local autenticada confirmou as superfícies e os destaques nos dois temas.
Build, jornadas autenticadas e contraste das 18 áreas são conferidos no CI
com PostgreSQL descartável. O resultado final por commit fica no PR desta branch.
Esta revisão visual ainda não foi promovida a Production.

## Conta de apresentação autorizada no Supabase

Os totais iniciais abaixo registram a primeira provisão. A complementação
posterior solicitada pelo responsável está documentada em
`docs/DADOS_APRESENTACAO_2026-09-07.md`: 5 profissionais com fotos,
60 clientes e 1.802 agendamentos, além do catálogo e indicadores preenchidos.

Após pedir usuário/senha com operação preenchida, o responsável especificou:
“crie no banco do supabase mesmo, como se fosse um novo cliente”. Foi provisionado
um estabelecimento novo e isolado, `Everflair Studio · Demonstração`, no projeto
produtivo `barber-saas` (`vshnatkzxdekkvqttvbv`). É uma conta persistente para
apresentações, não um ambiente de homologação de mudanças.

O cadastro foi aditivo, em transação com preflight de identidade e duplicidade,
IDs novos e plano de recuperação sem exclusão: suspender somente esse novo
estabelecimento caso necessário. Inclui 3 profissionais, 6 serviços, 12 clientes,
132 agendamentos, 84 recebimentos históricos fictícios, 3 produtos, 2 despesas,
um pacote, portfólio e 3 avaliações explicitamente fictícias. Telefones e WhatsApp
não foram preenchidos. Nenhuma mensagem externa foi enviada.

O acesso do proprietário é OWNER/PRO, sem privilégio global; o cliente tem
credencial própria. As senhas aleatórias ficam fora do Git e dos artefatos do CI.
Foram preservadas as configurações de RLS e a role de runtime `app_runtime`,
sem BYPASSRLS. A criação foi administrativa pelo conector, com IDs e GUCs do
novo estabelecimento; não foi executada pela role de runtime. Uma tentativa
inicial de assumir essa role foi recusada pelo banco e revertida integralmente.

Backup lógico criptografado das 19 tabelas envolvidas, com decifragem e checksum
conferidos antes da escrita: 658724 bytes, SHA-256
`0d0a371338249baea14a0dba57c518d6d41526e3877653eac739f288237e31be`.
Backup e evidências ficam em diretório privado fora do repositório.
Comparação de contagens e conteúdo ordenado confirmou a preservação dos registros
anteriores nas 19 tabelas. Em AppointmentService, a exclusão dos novos registros
usa salonId, pois a chave primária é composta.

Nenhuma migration, reset, alteração de autenticação ou concessão de privilégios
foi feita nessa provisão. O PostgreSQL local continua usando somente dados
sintéticos próprios; nenhum registro produtivo foi copiado para desenvolvimento.
