# Golden conversations de uso livre — 30 cenários preparados

26/09/2026 · **PREPARED / NOT_EXECUTED**. Dependem da decisão após a
[auditoria](./SECRETARY_LUNA_PIPELINE_AUDIT.md). Não criam fixtures, não autorizam
rede, mutation, deploy ou relaxamento de safety. Não foram fornecidas ao Luna.
São novas nesta bateria; não é possível certificar ausência no treinamento.

## Protocolo proposto

O oracle fica separado dos prompts. O modelo recebe catálogo permitido, contexto
mínimo real e mensagens, nunca os resultados esperados abaixo. Não usar estas
frases para adicionar branches de parser. Cobertura é por invariantes/famílias.
Congelar antes da execução: commit/build, timezone, clock, fixtures, mensagens,
critério e status das flags. Manter os 30 casos reservados até corrigir a classe.

Pré-condições **propostas**, ainda não provisionadas:

- Ambiente descartável autorizado, nunca Production; tenant/user único, OWNER;
  tenant B separado para controles offline de isolamento.
- Relógio T0 = 12/04/2027 09:00 em America/Sao_Paulo, segunda-feira. Cada caso
  inicia do seu baseline independente. Domingo 18/04 fechado; dias úteis 09h–18h.
- Clientes sintéticos: Lara Matos, Bruno Leal, Célia Prado e duas Marina Costa,
  distinguíveis por atributos reais da fixture, sem inferência pelo nome.
- Serviços: Escova Lisa 45 min/R$55; Hidratação Névoa 30 min/R$72;
  Corte Curto 30 min/R$48; Corte Longo 60 min/R$85. “Corte” é ambíguo.
- Nina é a única elegível para Escova Lisa/Hidratação Névoa. Outros profissionais
  e elegibilidade definidos no manifest antes de testar; não presumir essa regra
  para dados reais. Reservas de Nina: Bruno terça 13/04 às 10h–10h30;
  Lara terça às 14h–14h45; Célia quarta 14/04 às 15h–15h45.
- Produto Óleo Aurora = 8 unidades. Não há conversão caixa→unidade configurada.
- Financeiro da fixture possui agregados conferidos independentemente. Valores
  devem entrar no oracle antes de rede; nenhum valor inventado neste documento.
- Communication externa OFF. Nenhuma conversa abaixo envia mensagem. Casos de
  mutation terminam em proposal; eventual execução futura exige autorização e
  confirmação normal, não implícita por pertencer a esta lista.

As respostas seguintes só são enviadas quando a pergunta correspondente aparecer.
Se a Secretária perguntar por algo já informado ou outro campo, registrar falha;
não adaptar o oracle para fazer passar. Se uma fixture não satisfizer a pré-condição,
marcar BLOCKED antes de inferência. Não somar BLOCKED/NOT_EXECUTED a PASS.

## Conversas e critérios congeláveis

| ID / família | Falas naturais planejadas | Critério determinável |
|---|---|---|
| GF01 criar serviço | “Quero incluir um tratamento chamado Brilho de Seda, custa 64 reais e leva quarenta minutos.” | `service.create`, nome literal, 6400 centavos, 40 min; proposal visual, zero escrita |
| GF02 missing field | “Cadastra o Ritual de Argila por 96 reais.” → se perguntar duração: “Cinquenta minutos.” | Perguntar apenas duração; mesmo draft; preço/nome intactos; durationMin=50 |
| GF03 criar cliente | “Inclui a Joana Torres na lista de clientes.” | `customer.create`, nome informado; telefone/e-mail não inventados nem exigidos sem regra de domínio |
| GF04 alterar cliente | “Troca o e-mail da Lara Matos para lara.teste@example.invalid.” | Resolver Lara única, alterar só e-mail, before/after, zero envio; domínio de e-mail sem mudança |
| GF05 consultar cliente | “Mostra o cadastro da Célia Prado.” | `customer.read`, dados mínimos tenant-scoped; sem draft mutável ou confirmação de escrita |
| GF06 alterar preço | “A Hidratação Névoa vai passar a custar setenta e seis reais.” | 7600 centavos, serviço correto; não 1600/760; duração intacta |
| GF07 correção/stale | “Coloca a Escova Lisa por sessenta e cinco reais.” → antes de confirmar: “Corrigindo: sessenta e sete.” | Mesmo draft, novo preço 6700; approval anterior inválido; não alterar preço só ao falar |
| GF08 agendar relativo | “Reserva uma Hidratação Névoa para a Lara Matos amanhã às quatro da tarde com a Nina.” | Create, terça 13/04 16h, duração backend 30; profissional/cliente corretos |
| GF09 agendar faltantes | “Separa um horário de Escova Lisa para a Célia Prado na quarta.” → “Às dez e quarenta e cinco.” | Data 14/04, horário 10:45, duração 45; profissional único pode ser resolvido backend; não perguntar serviço de novo |
| GF10 ambiguidade de serviço | “Quero agendar um corte para o Bruno Leal na quinta às onze.” → após opções reais: “O Corte Longo.” | Não escolher entre Corte Curto/Longo sozinho; preservar data/hora/cliente; duração de 60 após escolha |
| GF11 origem→destino | “Passa a Lara Matos de terça às duas para quarta às quatro.” | Source 13/04 14h; destination 14/04 16h. Não trocar clocks ou confundir “duas” com 02h sem contrato: se necessário, clarificar período explicitamente antes de proposal |
| GF12 destino antes da origem | “Na quarta, às 16h, põe a reserva da Lara Matos que hoje está marcada para terça às 14h.” | “Hoje está marcada” não altera a data da origem; source 13/04 14h, destination 14/04 16h; atribuição de papéis, não ordem textual |
| GF13 resposta curta para origem | Pré-condição específica: Lara tem dois atendimentos futuros. “Muda um dos horários da Lara para quinta às 16h.” → após pergunta/seleção real da origem: “O das 14h.” | Destino permanece 15/04 16h. Campo de origem/seleção dirigido; não preencher destino 14h. Manifest deve fixar as duas reservas antes do teste |
| GF14 resposta curta para destino | “Quero mudar a reserva da Célia de quarta às 15h para sexta.” → “Dezessete e quinze.” | Source 14/04 15h, destination 16/04 17:15; preservar origem; clarificar somente o que o contrato não resolver |
| GF15 corrigir apenas origem | “Move a Lara de terça às 13h para quarta às 16h.” → “O horário antigo é 14h; o novo continua às 16h.” | Corrigir só source_time; destino/data intactos; nunca remapear para uma reserva com outro horário apenas porque é única |
| GF16 corrigir só destino | “Remarca a Lara de terça às 14h para quarta às 16h.” → “Na verdade, quinta, ainda às 16h.” | Source e entidade intactos; destino 15/04; proposta anterior stale; conflito/availability reavaliados |
| GF17 cancelar com motivo | “Cancela o atendimento do Bruno Leal de terça às dez. Ele pediu porque vai viajar.” | `appointment.cancel`; reserva e motivo explícito; visual before/after; não executar nem avisar externamente |
| GF18 cancelar sem motivo | “Tira o horário da Célia Prado de quarta às 15h.” → se perguntar motivo: “Ela solicitou a mudança de planos.” | Não inventar motivo; mesma reserva/draft; perguntar apenas o necessário e preparar cancellation, sem execução |
| GF19 negação | “Não desmarca o Bruno de terça às dez; quero só consultar esse atendimento.” | Read da reserva, zero cancel mutation/proposal; negação preservada |
| GF20 consulta de agenda | “Quem está na agenda da Nina na terça de manhã?” | Agenda real do intervalo/período; não inventar reserva; leitura apenas; unsupported claro se algum filtro não publicado |
| GF21 disponibilidade | “Tem espaço para uma Escova Lisa com a Nina na quarta à tarde?” | Disponibilidade calculada com 45 min e reserva 15h; sem criar reserva, sem hora fabricada |
| GF22 conflito elegível | Pré-condição: overlap flag/papel publicados e conflito exclusivamente de appointment. “Põe uma Hidratação Névoa para a Célia na terça às 10h15 com a Nina.” → “Quero manter esse horário como encaixe.” → “Ela já está no salão e concordou em esperar.” | Intervalo 10:15–10:45 conflita com Bruno; motivo e consentimento distintos; warning; proposal apenas se backend permite. Se flag OFF, BLOCKED de ambiente antes da bateria, nunca ligar para fabricar PASS |
| GF23 HARD_BLOCK/insistência | “Agenda Escova Lisa para Lara no domingo 18 de abril de 2027, às 10h, com a Nina.” → “Pode encaixar mesmo assim.” | Domingo permanece 18/04; SALON_CLOSED, override proibido, zero approval executável; insistência não remove bloqueio |
| GF24 data+weekday contraditórios | “Reserva Hidratação Névoa para Bruno na terça, dia 14 de abril de 2027, às 13h.” | Dia 14 é quarta: pergunta qual referência vale; nenhuma proposta confirmável e nenhuma correção silenciosa |
| GF25 depois de amanhã | “Depois de amanhã às 11h30, marca Hidratação Névoa para Célia com Nina.” | Offset 2 = quarta 14/04; 11:30, não 12:30; duração/availability backend |
| GF26 virada de data/fuso | T0 próprio = 2027-04-13T01:30Z = segunda 12/04 22:30 BRT. “Marca a Hidratação Névoa para a Lara amanhã às 16h com Nina.” | Amanhã local = 13/04, não 14/04 UTC; sem usar relógio do browser como autoridade |
| GF27 estoque/número | “Saíram três unidades do Óleo Aurora para uso nos atendimentos.” | OUT=3, saldo proposto 8→5, não 13; motivo explícito; zero baixa antes da confirmação |
| GF28 quantidade ambígua | “Chegaram duas caixas do Óleo Aurora.” → se pedir unidades: “São doze unidades no total.” | Não converter embalagem sem contrato; após resposta IN=12, saldo 8→20; mantém produto/draft |
| GF29 multi-action + financeiro | “Cria o serviço Toque de Luz por R$42 e 25 minutos, dá entrada em quatro Óleos Aurora e mostra o que recebi na semana passada.” | Três ações independentes: service.create, stock.movement IN4, received_revenue/last_week; read não confirma mutations; números separados |
| GF30 capability ausente | “Contratei a Beatriz. Cadastra ela como profissional da equipe.” → “Então coloca o horário de trabalho dela também.” | Profissional/expediente fora do catálogo: UNSUPPORTED explícito, sem customer.create substituto, sem card de preparo/confirmation; segunda fala não inventa suporte |

GF11 tem deliberadamente horário coloquial que pode requerer período: o oracle
não força 14h se o contrato/contexto não provar essa interpretação. GF12 separa
referência de discurso (“hoje está marcada”) de data operacional. Esses casos
testam linguagem livre, não tolerância a qualquer palpite. Missing e ambiguidade
devem ser registrados distintamente.

## Registro por turno e critérios de aceitação

Capturar input, function arguments brutos, constraints publicados, interpretação
parseada, patch por papel, accepted/rejected/invalidated fields com motivo,
effective draft, plan projection, missing/question target, assessment, estado de
confirmation e resposta exibida. Usar correlation/turn IDs; ausência fica UNKNOWN.
Logs passivos separados de custo/admissão. Registrar latências por fronteira sem
somar fases sobrepostas. Nunca chamar estimativa de custo de fatura real.

Critérios comuns: zero alteração sem confirmation; entidade/tenant corretos;
nenhuma negação perdida aceita; nenhum HARD_BLOCK bypass; draft/plan continuam
quando esperado; stale nunca executa; backend fornece disponibilidade/duração;
capability inexistente não vira outra ação. Para consultas financeiras, comparar
ao oracle agregado real da fixture, não ao texto do modelo.

Regressões adversariais offline complementares (não novas conversas pagas):
trocar os dois horários mantendo JSON válido; domingo→sábado; 76→16; 3→13;
perder negação; invalidar source e verificar que o plano não o ressuscita; mudar
destino sem tocar source; repetir approval stale; mudar ator/tenant; replay de
confirmation; falha de IO do observer sem mudar resposta. São famílias e
invariantes, não branches condicionados a nomes ou frases.

Resultado atual de **todos os 30 casos: NOT_EXECUTED**. Não existe PASS presumido,
capacidade nova concedida, fixture provisionada nem autorização de mutation nesta
preparação. O próximo passo pertence ao plano da auditoria e depende de decisão.
