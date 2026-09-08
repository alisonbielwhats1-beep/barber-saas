# Cliente: agendamento, acesso, temas e acompanhamento

Implementação autorizada após a auditoria da seleção de serviços. Branch
`codex/client-booking-clarity`, baseada em `aca303b` (PR #82). Sem migration,
serviço pago ou operação de teste em Production.

## Comportamento

- Catálogo agrupado por categoria, busca global e seletor acessível de todas
  as categorias. Uma coluna de serviços, sem fotos/ícones repetidos, seleção
  explícita e resumo fixo dentro da viewport. Nomes/descrições preservados;
  abreviações conhecidas de combos são expandidas apenas na apresentação.
- Etapas Serviços, Profissional, Horário e Confirmar indicam progresso. Preço,
  duração e serviços acompanham a escolha, com retorno para alterar. Limite de
  dez serviços e incompatibilidade de profissional têm orientação imediata.
- Consulta de serviços e disponibilidade sem login. Confirmação, fila,
  dependentes, reagendamento e reservas pessoais continuam autenticados no
  servidor. Autenticação preserva serviços/profissional/data/horário na URL
  segura e no estado temporário sem dados pessoais. O horário é revalidado;
  não é retido durante o login. Reagendamento usa estado temporário separado.
- Entrada com marca menor, tipografia mais compacta, ação principal Agendar
  um horário e acesso à conta secundário. Login e cadastro compartilham a
  mesma composição.
- Introdução do cliente renderizada no HTML inicial, corrigindo tela de
  acesso → animação → tela de acesso. Fundo grafite, marca lilás clara com
  revelação suave e luzes discretas. Saída em 2,2 s; reduz movimento quando
  solicitado e não repete durante navegação interna. CSS libera a interface
  mesmo sem JavaScript; clique/tecla dispensam a animação.
- Tema claro/escuro no topo de todas as telas do cliente, independente do
  painel. Cookie de aparência lido no servidor evita restaurar o tema depois
  da primeira pintura. Diálogos acompanham a escolha. Claro em branco frio,
  cartões brancos, sombras discretas e verde profundo; escuro em grafite.
- Próxima reserva prioriza data/hora e status; ações bloqueadas pelo prazo
  explicam o motivo e apontam para contato. Histórico é secundário.
- Último atendimento concluído sem avaliação ganha convite destacado, com
  Agora não. Formulário esclarece publicação e nome abreviado, mantém comentário
  opcional e estrelas navegáveis pelo teclado. Histórico mantém acesso à nota.

## Verificação

- Lint, TypeScript e suíte Vitest; novas regressões cobrem HTML inicial da
  animação, tema/portais, catálogo público e autenticação antes de confirmar,
  revalidação de horário no retorno e teclado das avaliações.
- E2E em PostgreSQL 16 descartável: temas em 320/390/844/1280 px, ausência de
  overflow, contraste axe, catálogo sem login e jornada autenticada existente.
- Capturas locais usam exclusivamente os dados sintéticos de everflair-demo.
- Build, CI e Preview precisam passar para a versão final do PR. Preview sem
  staging continua limitado à landing pelo guard; jornada autenticada é
  verificada localmente e no banco descartável do GitHub.
- Sem teste físico em iPhone/Android ou promessa de conformidade WCAG integral.

Resultados por commit ficam no PR da entrega. Publicação produtiva desta
revisão não foi realizada.
