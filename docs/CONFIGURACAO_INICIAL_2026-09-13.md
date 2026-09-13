# Guia de início — 13/09/2026

Branch `codex/initial-setup`, base `f89652b` (`origin/master`).

## Pedido e diagnóstico

O responsável pediu uma tela de configuração inicial para quem começa a usar
o aplicativo, em computador e celular, com liberdade para pular e retomar.
Também pediu orientação explícita sobre o aplicativo do cliente, como ele
funciona e onde encontrar o link para compartilhar.

Antes: o cadastro comum levava ao dashboard; o checklist confundia existência
de serviço com preço revisado, jornada de qualquer pessoa com profissional
compatível e conclusão de configuração com receber a primeira reserva.
O horário geral já era separado das jornadas desde o PR #84 e suas revisões.

## Comportamento

- `/onboarding/configuracao` oferece horários, serviços, profissionais e aplicativo.
- Cadastro comum abre o guia. Contratação selecionada continua no portal de
  assinatura, que oferece um atalho explícito ao guia; cobrança permanece intacta.
- A primeira visita ao dashboard por proprietário sem reservas, sem progresso
  registrado e sem configuração essencial completa abre o guia automaticamente.
  Operações existentes não são interrompidas. Profissional e recepção não entram.
- Cada salvamento e adiamento é persistido por estabelecimento. O dashboard
  permite retomar; “Guia de início” permanece no menu inclusive após concluir.
- Horários aceitam dias fechados, vários períodos, pausas e meia-noite. Salvar
  a referência não altera nenhuma jornada existente.
- Serviços sugeridos com preço zero exigem revisão e confirmação de gratuidade.
  Edição mantém categoria, tipo de preço, etapas e demais atributos existentes.
- O dono pode ativar sua própria agenda, com limite de plano e sem novo usuário,
  senha ou convite. Equipe continua no fluxo existente de Profissionais/convites.
- Serviços são associados de forma aditiva ao profissional. Copiar horários exige
  seleção explícita e só cria jornada ausente; jornadas existentes usam o editor
  compartilhado. Não há remoção de vínculo, folga, bloqueio ou reserva pelo guia.
- Concluir requer serviços revisados e, para cada um, profissional com jornada
  que comporte sua duração. Não exige primeiro agendamento. Disponibilidade real
  continua sujeita ao motor de reservas, recursos, folgas e bloqueios.
- A última etapa mostra o link oficial, copiar/abrir, explicação de escolha de
  serviços/profissional/horário e conta para confirmar. Instalação é opcional.
  Ensina “Compartilhar” no desktop e “Mais → Compartilhar” no celular, incluindo QR Code.

## Persistência e segurança

Sem migration. Usa Salon, Service, Professional, ProfessionalService,
WorkingHours e a trilha append-only AuditLog existente. Eventos de progresso,
horários e revisão de serviço usam actions específicas. Progresso não concede
acesso público ou direito de plano; as regras atuais continuam no servidor.

Páginas e ações verificam papel/tenant e usam withTenant. O dono só ativa a própria
agenda autenticada. Validação de capacidade usa o mesmo lock e entitlement da
operação existente, incluindo convites pendentes. O guia serializa suas escritas
por estabelecimento; jornada usa também o lock operacional do profissional.

## Verificação e publicação

Unitários cobrem acesso por papel, IDs de outro estabelecimento, gratuidade,
preservação de jornada, capacidade, adiamento e conclusão sem reserva.
Navegador usa banco sintético dedicado e verifica 320, 390, 768 e 1440px,
temas claro/escuro, axe, retomada e disponibilidade real da API após configuração.
Os resultados finais serão registrados nesta seção e no PR.

Desenvolvimento local isolado: PostgreSQL em 127.0.0.1:55439; nenhum dado
produtivo copiado. CI/schema-smoke mantém PostgreSQL descartável e migrations
reais do projeto. Preview sem staging continua restrito pelo guard existente.
Não houve promoção produtiva. Recuperação de código: reverter o PR; os eventos
append-only podem permanecer e os dados configurados continuam utilizáveis.
