# Agenda — matriz de cobertura de capacidades (29/09/2026)

Auditoria **somente leitura** da candidata 67c9c297f43e0d98, feita antes de fechar o escopo da Candidata 4.
Três mapeamentos independentes (backend/domínio, Secretária, testes), um verificador adversarial e uma síntese. Nenhum arquivo foi alterado.

Auditoria de CAPABILITY COVERAGE da Agenda, só leitura (nenhum arquivo alterado). Cruzei os três mapeamentos (backend, Secretária, testes) e apliquei as correções do verificador. Conferi eu mesmo no código quatro pontos: o limite de 50 na lista, o corte de 5 horários livres, o filtro de busca que olha só o serviço principal e a exigência de data/hora na remarcação.

**Números (C01–C36)**
- **Backend:** 26 suportadas, 9 parciais, 1 não suportada (C12, duração).
- **Secretária:** 5 expostas, 9 parciais, 11 ausentes e 11 proibidas.

**Onde está o buraco principal: o backend tem, a Secretária não usa**
- Trocar, adicionar e remover serviço (C09–C11) e trocar profissional (C08): o backend já faz por requestStaffReschedule, recalculando duração e preço.
- Vários serviços num agendamento (C02).
- Cliente novo (C05) e recorrência (C03).
- Marcar falta, check-in e concluir (C17/C18) e observações (C23).
- Folga de dia inteiro (C25) e encaixe ao remarcar (C19).
- Desbloquear, fechar o salão e mudar a jornada (C26–C28).
- Próximo horário de um cliente sem data (C32).

**Nem o backend suporta**
- Duração manual do agendamento (C12).
- Preço ou desconto antes da comanda (C13).
- Equipe inscrever cliente na fila (C22).
- Busca de próximo horário livre por vários dias (C31).
- Escolher sala (C35).
- Envio real de mensagem (C33/C34).
- Cancelar uma série recorrente inteira.
- Taxa de falta: configurável, mas nunca cobrada.

**Nunca entraram em bateria**
C02, C09–C13, C15/C16 por escopo, C17, C18, C23, C31, C32 sem data e C29 com o salão inteiro.

**Riscos novos encontrados**
- Na remarcação, professional_name e service_name funcionam como filtro de busca. Por isso 'com a Stephanie' procura os agendamentos da Stephanie e não acha nada.
- appointment.change exige data e hora de destino. Trocar só o serviço pediria um horário novo.
- A busca sem data filtra só o serviço principal.
- O exemplo R041 ensina a criar um 2º agendamento em vez de adicionar serviço.
- A lista do dia recusa acima de 50 linhas, e checa isso antes de aplicar o filtro de período.
- Os horários livres são cortados em 5 sem aviso.
- Uma remarcação pela Secretária já entrega o horário liberado ao 1º da fila, e a prévia não diz isso claramente.
- Não verificado: recorrência ou duração podem ser descartadas em silêncio ou desviadas para o catálogo.

**Síntese para a Candidata 4 (só alta frequência e alto valor)**
- **Juntados a itens já planejados, com os detalhes acima:**
  - alterar dados do agendamento (C08–C11);
  - multi-serviço na criação e na disponibilidade (C02 + C30);
  - horário liberado por remarcação × fila de espera (C21);
  - guarda contra recorrência descartada, dentro da negação residual (C03/X01).
- **Novos e baratos, todos só leitura:**
  - C32: próximo horário de um cliente sem data;
  - C29: agenda do salão inteiro e dia cheio;
  - C30/C31: disponibilidade sem profissional, próximo horário livre e aviso de corte.
- **Confirmados como já cobertos pelo C4:** C06/C07/C14 (datas e 'mesmo horário'), C20-D3 ('mesmo serviço') e C36 ('meu horário').
  - Detalhe do C36: o papel PROFISSIONAL hoje não usa a Agenda pela Secretária, e o dono que atende precisa ser ligado ao seu cadastro de profissional (Professional.userId).

**Ficam para depois:** C05 e C25 (MEDIA; a versão mínima cabe nos loops de esclarecimento), encaixe ao remarcar, operações em lote por escopo, falta/check-in, observações, desbloqueio, produtos reservados e os demais.

**Conflitos com oráculos, para decidir antes da prova**
- T13/MD13B1 espera a troca de profissional, que o contrato atual proíbe; passa a ser atingível com o item de alterar dados.
- B09 (congelado) roteiriza a pergunta de início e fim da folga.
- S074 (banco) espera o próximo horário do cliente sem data.
- R041 (banco) ensina o agendamento separado.

## Matriz

| ID | Capacidade | Backend | Secretária | Testada | Gap | Prioridade | Frequência | Esforço |
|---|---|---|---|---|---|---|---|---|
| C01 | Criar com 1 serviço | Sim | Exposta | Luna real OK | Nenhum novo (falhas de data 'dia N' já estão no C4) | - | Muito alta (várias por dia) | - |
| C02 | Criar com vários serviços ('corte e barba') | Sim (serviceIds 1-10; createVisit junta os itens do mesmo profissional num agendamento) | Ausente (service_name único) | Não (o combo 'Corte e barba' do catálogo esconde o buraco) | Não dá para pedir; 'faz barba também' vira um 2º agendamento separado (exemplo R041) | ALTA | Alta (diária) | M |
| C03 | Recorrente (toda semana) | Sim (semanal/quinzenal, 2-24 vezes; datas com conflito são puladas) | Ausente | Não | Não dá para pedir; risco (não verificado) de criar um único agendamento sem avisar | MEDIA | Semanal (clientes fixos) | M |
| C04 | Para dependente (filho/filha) | Parcial (o domínio aceita; só o portal do cliente usa) | Ausente; alterar/cancelar é bloqueado | Não (só o texto da recusa) | Falta caminho no admin e na Secretária | BAIXA | Baixa | L |
| C05 | Cliente novo (não cadastrado) | Sim (cadastro do cliente criado na hora) | Proibida ('ausência não cria entidade') | Só a recusa (B10) | Beco sem saída: não oferece cadastrar; customer.create não se encadeia com o agendamento | MEDIA | Média (semanal) | M |
| C06 | Remarcar data e hora | Sim | Exposta (mantém serviço, profissional e preço; cliente com conta precisa aceitar) | Luna real OK | Falhas 'dia N'+dia da semana (B2/B5/B6) e apelido (N12): já no C4 | ALTA | Muito alta | - |
| C07 | Só a hora / só o dia ('no mesmo horário') | Sim (a tela monta data+hora) | Parcial (só a hora funciona; 'mesmo horário' em outro dia pergunta a hora) | Luna real parcial (V15/V18/N04 OK; D2 falha) | Herdar a hora do próprio agendamento: já no C4 (referências) | ALTA | Muito alta | - |
| C08 | Trocar profissional mantendo o horário | Sim (arrastar no quadro; editAppointment aceita professionalId, mas a tela de detalhe não oferece) | Proibida; o nome do novo profissional vira filtro de busca | Luna real: falha (E1); o oráculo T13 contradiz o contrato | Já no C4; hoje 'com a Stephanie' busca os agendamentos da Stephanie e não encontra | ALTA | Alta (semanal a diária) | M |
| C09 | Trocar serviço | Sim (lista de serviços no detalhe; recalcula duração e preço) | Proibida (o executor reenvia os serviços atuais) | Não | Caso Alison; já no C4. appointment.change exige data e hora de destino | ALTA | Alta (diária) | M |
| C10 | Adicionar serviço | Sim (até 10) | Proibida | Não | Risco de virar um 2º agendamento (padrão do R041); já no C4 | ALTA | Alta | M |
| C11 | Remover serviço | Sim (mínimo 1) | Proibida | Não | Já no C4, junto com o C09 | ALTA | Média | S |
| C12 | Alterar duração do agendamento | Não (o fim sai sempre dos serviços) | Proibida (CAPABILITY_FIELD_MISMATCH) | Não (GF01/02 testam o catálogo) | Precisa de domínio/schema; risco de ir parar em service.change (catálogo) | MEDIA | Média | L |
| C13 | Preço/desconto do agendamento | Parcial (só na comanda ou por regra automática) | Proibida | Não | Financeiro; risco de alterar o preço do catálogo | BAIXA | Média (no checkout) | L |
| C14 | Cancelar com motivo | Sim (dono/gerente) | Exposta (motivo literal de 3+ caracteres; recepção não cancela) | Luna real OK (V10 1/3, V19 0/3) | Falhas de data B1/B3: já no C4 | ALTA | Muito alta | - |
| C15 | Cancelar vários (dia/profissional) | Parcial (cancelSelectedAppointments; na tela só depois de um bloqueio) | Parcial (só por nome, um motivo por item) | Só 2 nomes (V16, N05, N06) | Não há 'todos de amanhã da X'; um motivo comum não vale para os outros | MEDIA | Mensal (profissional faltou) | L |
| C16 | Remarcar vários | Parcial (só dentro de uma série recorrente) | Parcial (várias remarcações por nome) | Por nome: falha C1 (loop 02h/14h, já no C4); por escopo: Não | Não há 'passa todos da Tatiana pra segunda' | MEDIA | Mensal | L |
| C17 | Marcar falta (no-show) | Sim (só depois do início; a taxa de falta nunca é cobrada) | Ausente | Não | Não existe operação de status | MEDIA | Semanal | S |
| C18 | Check-in / confirmar / concluir | Sim | Ausente | Não | Não existe operação de status (hoje se faz na tela /hoje) | MEDIA | Diária (na tela) | M |
| C19 | Encaixe com motivo | Sim (ao criar e ao editar; só conflito entre agendamentos) | Parcial (só ao criar e com flag; ao remarcar não; fora do expediente é HARD_BLOCK) | Luna real OK (B05, GF22; GF23 regrediu) | Sem encaixe ao remarcar ou ao aumentar serviços | MEDIA | Diária ao criar; semanal ao remarcar | S |
| C20 | Pôr cliente no horário liberado por cancelamento | Sim (em 2 operações) | Exposta (T21 atômico, mesmo profissional) | Luna real OK (V17 3/3, N19; V27 1/1; D3 falha) | 'Pro mesmo serviço' não é herdado (D3): já no C4 | ALTA | Semanal | - |
| C21 | Pôr cliente no horário liberado por remarcação | Sim (em sequência; a remarcação entrega o horário à fila de espera do agendamento) | Não suportada (guarda INVALID_DEPENDENCY_GRAPH; same_as copia o destino) | Só a falha avulsa D1; o efeito na fila tem teste de integração | Já no C4; colide com a promoção automática da fila | ALTA | Semanal | M |
| C22 | Lista de espera (inscrever/oferecer) | Parcial (a equipe não inscreve cliente) | Ausente (a remarcação promove o 1º da fila sem avisar) | Integração (só o efeito colateral) | Inscrever e oferecer vaga | BAIXA | Semanal | L |
| C23 | Observações no agendamento | Sim (ao criar e editar) | Ausente | Não (só a preservação das notas) | Não há campo; a nota ditada se perde | MEDIA | Diária (pouco crítica) | S |
| C24 | Bloquear intervalo | Sim (vários profissionais, recorrência) | Exposta (1 profissional por ação, sem recorrência) | Luna real (V08 2/3, V25 2/3, N17/N18 0/2) | Recorrência; falhas N17/N18 em aberto | MEDIA | Semanal | M |
| C25 | Folga de dia inteiro / férias | Sim (atalho 'Dia inteiro' de 00h às 00h; até 366 dias) | Parcial (sempre pergunta início e fim) | Luna real B09 (respostas roteirizadas); vários dias: Não | 'O dia todo' não é resolvido; se o dono repetir, pode entrar em loop | MEDIA | Semanal | S |
| C26 | Fechar o salão (feriado) | Sim (dias inteiros, em /configuracoes) | Proibida (salon_hours) | Só a recusa (unitário/banco) | Fora da Agenda core | BAIXA | Poucas vezes por ano | M |
| C27 | Desbloquear / remover folga | Sim | Proibida | Só a recusa (unitário) | Um bloqueio feito pela Secretária não pode ser desfeito por ela | MEDIA | Semanal a mensal | M |
| C28 | Alterar jornada/expediente | Sim | Proibida | Luna real: recusa OK (GF30) | Configuração rara | BAIXA | Rara | M |
| C29 | Agenda do dia (profissional ou salão) | Sim (dia e semana, filtros) | Parcial (1 dia; acima de 50 linhas responde 'restrinja por cliente') | Luna real só com profissional (V24 2/3, N21 0/2) | Salão inteiro nunca testado; o limite de 50 é checado antes do filtro de período e trava salão médio | ALTA | Muito alta (diária) | S |
| C30 | Horários livres (serviço/profissional/dia) | Sim | Parcial (exige serviço, profissional e data; mostra no máximo 5 horários sem avisar) | Luna real OK (V23 2/3, N22, GF21) | A lista parece completa; não aceita N serviços | ALTA | Muito alta | S |
| C31 | Próximo horário livre / quem está livre às X | Parcial (por composição; findVisitPlan devolve só o 1º profissional) | Ausente (pergunta 'Qual profissional?') | Não (falha incidental C3) | Faz uma pergunta que o dono não sabe responder | ALTA | Alta (diária; clientes sem horário) | M |
| C32 | Próximo horário de um cliente | Sim (listUpcomingCustomerAppointments; CRM) | Parcial (consulta e lista exigem data) | Com data sim (GF19); sem data Não | 'Quando é o horário da Ana?' pede a data; o exemplo S074 do banco contradiz o contrato | ALTA | Muito alta | S |
| C33 | Avisar o cliente sobre a alteração | Parcial (aviso interno + link manual do wa.me; provedor fake) | Parcial (mensagem individual fake depois de criar, remarcar ou cancelar) | Luna real: C08 falha no texto; create→mensagem só em unitário | Envio real é decisão de produto | BAIXA | Diária | L |
| C34 | Lembretes automáticos | Parcial (cron interno; marcar lembrete à mão) | Ausente | Não | Fora da Agenda core | BAIXA | Diária (automático) | L |
| C35 | Recurso físico (sala/cadeira) | Sim (vem do serviço; não dá para escolher) | Ausente (só respeitado como restrição) | Integração | Escolher a sala não existe nem no backend | BAIXA | Baixa | L |
| C36 | 'Minha agenda' / 'meu horário' | Parcial (automático só para o papel PROFISSIONAL; dono que atende não tem visão própria) | Ausente (não liga o usuário ao profissional; o papel PROFISSIONAL não usa a Agenda) | Luna real: falha (C2/E2) | Já no C4 | ALTA | Alta (dono que atende) | - |
| X01 | Bloqueio/pausa recorrente ('almoço todo dia', 'folga toda segunda') | Sim (everyWeeks/count/weekdays/untilDate) | Ausente (1 intervalo) | Não | Risco de criar 1 bloqueio só, sem avisar | MEDIA | Mensal (configuração) | M |
| X02 | Alterar/cancelar agendamento com produtos reservados | Sim | Proibida (SCHEDULING_RELATION_NOT_SUPPORTED) | Só o texto da recusa | Remarcar e cancelar ficam bloqueados nesses casos | MEDIA | Depende do uso de reserva de produto | M |
| X03 | Deixar o próximo marcado (repetir o último atendimento, daqui N semanas) | Sim (duplicateAppointment, getLastAppointmentServices) | Ausente (same_as só referencia ações do mesmo pedido) | Não | Referência ao atendimento atual ou ao último do cliente | MEDIA | Diária (fim do atendimento) | M |
| X04 | Exceção de expediente (atender fora do horário / terminar depois) | Sim (motivo + auditoria) | Ausente (HARD_BLOCK) | Não | 'Encaixa às 19h30, depois de fechar' é recusado | MEDIA | Semanal | M |
| X05 | Agenda da semana/período | Sim (visão semanal) | Ausente (lista de 1 data) | Não | Não dá para pedir | BAIXA | Semanal | S |

## Gaps de alta frequência/valor incorporados à Candidata 4

### C08+C09+C10+C11 (junta com o item planejado 'alterar dados do agendamento')

- **Por quê:** É o pedido mais comum depois de criar, remarcar e cancelar (caso Alison). O backend já faz isso por requestStaffReschedule (serviceIds + professionalId), recalculando duração e preço. Na Secretária é proibido e nenhuma bateria testa. A auditoria achou quatro detalhes que o item planejado ainda não cobre: (1) appointment.change exige data e hora de destino, então trocar só o serviço hoje pediria um horário novo; (2) professional_name e service_name numa remarcação funcionam como FILTRO de busca, então o valor novo é lido como localizador; (3) a busca sem data filtra só o serviço principal (scheduling-mutations.ts:39,44), ao contrário da busca com data, que olha todos os serviços (scheduling-catalog.ts:147); (4) o exemplo R041 ensina 'faz X também' como um agendamento separado.
- **Escopo:** Na remarcação, separar a ORIGEM (localizadores) do DESTINO (serviços e/ou profissional). Mudança só de serviço ou de profissional mantém data e hora sem exigir destino. O executor envia a nova lista (trocar, adicionar, remover; 1-10 serviços) e o novo professionalId. A proposta mostra ANTES→DEPOIS com serviços, preço, duração e profissional. Corrigir a busca sem data para considerar todos os serviços. Revisar o R041. FICA FORA: encaixe na alteração (se colidir, oferecer alternativas), duração e preço manuais, agendamentos com produtos ou dependente (a guarda continua).
- **Segurança:** Nada grava sem Confirmar; versão e idempotência iguais às da remarcação. A disponibilidade é checada de novo com a nova duração (HARD_BLOCK e conflitos como hoje). O profissional precisa fazer todos os serviços; se não fizer, PRO_SERVICE_MISMATCH e a Secretária pergunta ou oferece quem faz. Serviços com nome parecido geram pergunta; mínimo de 1 serviço; negação nunca vira operação. Cliente com conta: a proposta avisa que vai para aceite. O papel PROFISSIONAL continua sem poder transferir. Manter a fronteira com service.change do catálogo.
- **Testes:** Unitário do contrato/wire: campos nullable, orçamento de bytes, fixtures gravadas continuam decodificando. Integração PostgreSQL do executor: novos serviços, preço e duração recalculados, versão, idempotência, conflito por duração maior, troca de profissional liberando o horário e a fila. Bateria DEV com nomes diversos: 'troque o serviço do X para barba e pezinho', 'ela vai fazer barba também' (não pode criar 2º agendamento), 'tira a barba', 'passa pra Y no mesmo horário', profissional que não faz o serviço, Corte/Corte infantil, 'não troca a barba'. Fronteira com o catálogo: 'muda o preço da barba pra 40' continua service.change; 'a escova da Ana vai demorar mais' NÃO pode alterar o catálogo. Com isso o oráculo T13/MD13B1 passa a ser atingível.

### C02+C30 (junta com o item 'multi-serviço' planejado)

- **Por quê:** 'Corte e barba' e 'pé e mão' são diários. O backend já cria UM agendamento com N serviços (createVisit junta os itens consecutivos do mesmo profissional; actions.ts:46 aceita até 10). A Secretária aceita um serviço só, e o combo 'Corte e barba' do catálogo multi-salão esconde o buraco nos testes.
- **Escopo:** service_name vira uma lista em appointment.create e availability.get, sempre com o mesmo profissional. O executor passa choices[] com N itens (a guarda appointmentIds.length!==1 continua). A disponibilidade usa a duração somada. FICA FORA: visita com profissionais diferentes ('corte com João e unha com Maria').
- **Segurança:** Quando existem o combo exato do catálogo e os dois serviços separados, a Secretária pergunta e nunca escolhe sozinha. O profissional precisa fazer todos os serviços. Preço e duração vêm só do domínio. Wire compatível (nullable).
- **Testes:** Unitário do contrato. Integração: 2-3 serviços geram 1 agendamento, com AppointmentService na ordem certa e duração e preço somados. DEV com catálogo SEM combo e com combo de mesmo nome; disponibilidade para 2 serviços; 'ela quer fazer X também' dentro do mesmo pedido de criação.

### C32 (novo): próximo horário de um cliente sem data

- **Por quê:** 'A Ana tá marcada pra quando?' é uma das perguntas mais comuns. Hoje a consulta e a lista exigem data e a Secretária pergunta. O backend já tem listUpcomingCustomerAppointments, que só a proposta de criação usa. O exemplo S074 do banco já ensina a resposta que o contrato recusa.
- **Escopo:** appointment.read/list com cliente e sem data devolve os próximos agendamentos futuros (PENDING/CONFIRMED), com limite pequeno e aviso quando houver mais. Sem cliente, a data continua obrigatória. Só leitura; sem mudança de domínio.
- **Segurança:** Só leitura e dentro do tenant. Clientes com nome parecido geram pergunta. Nunca mostrar uma lista cortada como se estivesse completa. Uma data dita continua valendo.
- **Testes:** Unitário de requisitos (read/list sem data com customer_ref). Integração: 0, 1 e vários agendamentos; passados e cancelados ficam de fora; outro tenant não aparece. DEV: 'quando é o próximo horário da X?', 'a dona X tá marcada pra quando?', cliente sem agendamento futuro, nomes parecidos.

### C29 (novo): agenda do salão inteiro e dia cheio

- **Por quê:** 'Como está a agenda amanhã?' é a leitura mais frequente. appointment.list já aceita só a data, mas nenhum cenário testou sem profissional. Acima de 50 linhas a resposta é 'Restrinja a busca por cliente', o que trava um salão médio (5 profissionais × 12). Além disso, o limite de 50 é checado ANTES do filtro de período (secretary-scheduling.ts:290-291).
- **Escopo:** Cobrir a lista do salão inteiro. Aplicar o filtro de período/hora antes do limite. Acima do limite, responder com um resumo por profissional ou perguntar profissional/período, sem sugerir filtro por cliente.
- **Segurança:** Continua valendo a regra de nunca mostrar uma leitura cortada como completa. Só leitura.
- **Testes:** DEV com 3 ou mais profissionais sem nomear nenhum. Dia com mais de 50 agendamentos e tarde com menos de 50 ('agenda de amanhã à tarde'). Resumo acima do limite.

### C30+C31 (novo): disponibilidade sem profissional e próximo horário livre

- **Por quê:** 'Tem horário amanhã à tarde pra corte?' numa barbearia com vários barbeiros vira 'Qual profissional?', e o dono não sabe responder. 'Quem está livre às 15h?' e 'qual o próximo horário?' são diários (clientes sem horário, WhatsApp). A lista de no máximo 5 horários é cortada sem aviso e parece completa.
- **Escopo:** (a) Avisar quando houver mais horários do que os mostrados (S). (b) availability.get com profissional opcional: horários por profissional elegível numa data, hora ou período (M). (c) 'Próximo horário livre': busca à frente limitada (ex. 7 dias) para um serviço e um ou qualquer profissional (M). Tudo compondo getSchedulingAvailability/findVisitPlan em src/lib, sem mudar domínio ou schema.
- **Segurança:** Só leitura; 'a consulta não reserva o horário'. Busca limitada. Valem a jornada, fechamentos e bloqueios do tenant; o período dito prevalece (regra de daypart planejada). Marcar depois continua exigindo proposta, Confirmar e nova checagem.
- **Testes:** Unitário do contrato (profissional opcional). Integração com 3 profissionais, folga/bloqueio, salão fechado e fim de semana. DEV: 'quem está livre às 15h', 'tem horário amanhã à tarde pra corte' com vários barbeiros, 'próximo horário da Y', 'primeiro horário depois das 2' (C3).

### C21 (junta com 'horário liberado por remarcação' planejado): interação com a fila de espera

- **Por quê:** O item planejado não diz que a remarcação pela Secretária já entrega o horário liberado, automaticamente, ao 1º da fila daquele agendamento (appointment-service.ts:1343-1377; teste de integração :211 gera um agendamento CONFIRMED com origem WAITLIST). A prévia só diz 'pode ser oferecido'. 'Põe o Fábio no horário que o João deixou' colide com essa promoção, ou WAITLIST_BLOCKED desfaz a transação.
- **Escopo:** Definir quem tem precedência (pedido explícito do dono ou fila) e mostrar isso na prévia. Corrigir o texto da prévia de remarcação quando houver fila. same_as de uma remarcação precisa usar a ORIGEM (hoje copia o destino, secretary-same-as.ts:38-40).
- **Segurança:** Nenhuma promoção silenciosa contra o pedido. Lote all_or_nothing. Nada grava sem Confirmar.
- **Testes:** Integração: remarcação com fila + criação no horário liberado, testando as duas precedências. DEV: D1 reescrito com nomes diversos; remarcação simples com fila (a prévia precisa ser fiel).

### C03+X01 (junta com 'negação residual' planejado): só guarda, sem implementar recorrência

- **Por quê:** 'Marca a Ana toda sexta' e 'bloqueia o almoço todo dia' não têm campo. O risco (não verificado) é a Secretária executar uma única ocorrência sem avisar, e o dono só descobrir na semana seguinte. É o mesmo tipo de falha da negação residual: descartar parte do pedido.
- **Escopo:** Só guarda e teste. Recorrência dita gera UNSUPPORTED específico ou a pergunta 'marco só a primeira?'. Nenhuma implementação de recorrência.
- **Segurança:** Regra estrutural, nunca por frase. Nunca executar parte do pedido como se fosse o pedido inteiro.
- **Testes:** Adversariais DEV: 'toda semana', 'toda sexta às 10', 'almoço todo dia 12-13', 'a cada 15 dias', em agendamento e em bloqueio.

## Adiados (fora da Candidata 4)

- **C05:** MEDIA. O backend aceita cliente convidado, mas criar cliente a partir de um nome desconhecido traz risco de duplicar cadastro (apelido e nomes parecidos; N12 já falha). A versão mínima, a resposta de 'não encontrei' oferecer o cadastro, pode entrar no item planejado de loops de esclarecimento. Encadear customer.create com o agendamento fica para depois.
- **C25:** MEDIA. Hoje funciona com uma pergunta a mais. Colocar 'o dia todo' como resposta que resolve cabe no item planejado de loops de esclarecimento. Expandir sozinho (00h às 00h, como no admin, ou pela jornada) diverge do oráculo congelado B09, que roteiriza a pergunta e espera 09:00→19:00, e exige decisão do dono.
- **C19:** Encaixe ao remarcar ou ao alterar serviço: o backend aceita canOverbook, mas no C4 a alteração com colisão deve oferecer alternativas. Entra junto com X04 (exceção de expediente) numa candidata seguinte.
- **C15:** Cancelar vários por escopo exige seletor, confirmação em lote e resultado por item. O backend tem cancelSelectedAppointments. Frequência mensal. O motivo comum em cancelamentos por nome pode entrar na propagação de contexto multi-ação já planejada.
- **C16:** Remarcar vários por escopo não existe no backend fora de séries recorrentes. Os casos por nome já estão no C4 (daypart + multi-ação).
- **C17:** Marcar falta tem backend pronto e esforço S, mas ficou fora da lista de prioridades do dono. Candidato natural junto com C18 numa skill de status.
- **C18:** Check-in, confirmar e concluir já se fazem na tela /hoje; pelo chat a frequência é menor.
- **C23:** Observações: backend pronto e esforço S, mas pouco crítico; exige um novo campo literal no wire.
- **C03:** Implementar recorrência de agendamento: o backend existe, mas precisa de proposta de série com datas puladas. Só a guarda contra execução parcial silenciosa entra no C4.
- **C24/X01:** Bloqueio recorrente e vários profissionais numa ação: o backend suporta, mas são configurações e não o dia a dia. As variâncias N17/N18 vão para as correções de falhas reais.
- **C27:** Desbloquear precisa de localizador de bloqueios e de uma nova operação. Hoje é proibido de propósito.
- **X02:** Remarcar ou cancelar agendamento com produtos reservados exige tratar a devolução de estoque na proposta. A guarda atual é segura.
- **X03:** Deixar o próximo marcado e repetir o último atendimento: pode aproveitar o resolvedor de referências planejado ('mesmo serviço/horário'), mas o alvo é o histórico do cliente, não uma ação do mesmo pedido.
- **X04:** Exceção de expediente com motivo: o backend suporta, mas hoje a Secretária trata como HARD_BLOCK por segurança. Entra junto com o encaixe ao remarcar.
- **C12:** Alterar a duração exige domínio e schema (Appointment não tem campo de fim ou duração próprio). O risco de desvio para service.change está coberto pelos adversariais do item de alterar dados.
- **C13:** Preço e desconto são financeiros e existem só na comanda.
- **C04:** Dependente não tem caminho no admin nem na Secretária; a frequência é baixa.
- **C22:** A equipe não consegue inscrever cliente na fila; precisa de backend.
- **C26/C28:** Fechar o salão e mudar a jornada são configuração rara (salon_hours).
- **C33/C34:** Envio real e lembretes externos são decisão de produto e integração, fora da Agenda core.
- **C35:** Escolher a sala não existe nem no backend.
- **X05:** Agenda da semana: baixa prioridade depois que C29 cobrir o salão inteiro.

## Evidências por linha

- **C01:** actions.ts:113 createAppointmentManually; scheduling-actions.ts:59-72; GF08-10/25/26, V07/V09/V14/V20
- **C02:** actions.ts:46; visit-scheduling.ts ~483-492; scheduling-actions.ts:25,63,68-70; scheduling-catalog.ts:79; bank R041; generated-dev.json MD13B1
- **C03:** actions.ts:854 createRecurringAppointments; scheduling-skill.ts:133-153 (não há campo)
- **C04:** appointment-service.ts:837-847; actions.ts:212 dependentId:null; scheduling-mutations.ts:58
- **C05:** appointment-service.ts:812-827; scheduling-skill.ts:177; same-as.ts:41-44; secretary-scheduling.ts:173
- **C06:** reschedule-proposals.ts:148; scheduling-mutations.ts:70-98,143; GF11-16, V01-06
- **C07:** secretary-scheduling.ts:227-231; same-as.ts:59; prática C02; c4-failure-excerpts D2
- **C08:** skill-registry.ts:56; scheduling-skill.ts:174; scheduling-mutations.ts:39,143; agenda-board.tsx:570-577,688; reschedule-proposals.ts:148-155
- **C09:** appointment-detail.tsx:412-430; reschedule-proposals.ts:218-219,302-307,323; scheduling-mutations.ts:143; appointment-detail.test.tsx:67
- **C10:** appointment-detail.test.tsx:47; scheduling-mutations.ts:59,143; bank R041
- **C11:** appointment-detail.tsx:485; scheduling-mutations.ts:143
- **C12:** actions.ts:44-64,663-677,727-736; appointment-service.ts:131; scheduling-skill.ts:177; skill-registry.ts:162
- **C13:** comanda-service.ts:64-104; actions.ts:435-490; scheduling-mutations.ts:129 'Preço mantido'
- **C14:** appointment-service.ts:1405; scheduling-mutations.ts:115,142; GF17-19
- **C15:** availability-actions.ts:55-79; availability-panel.tsx:98; scheduling-mutations.ts:44-48,115
- **C16:** series-actions.ts:11-39; skill-registry.ts:294-297; c4-failure C1
- **C17:** actions.ts:253; appointment-service.ts:1618; appointment-domain.ts:62-67,104; scheduling-skill.ts:7
- **C18:** appointment-checkin.ts:6; hoje/actions.ts:9; updateAppointmentStatus actions.ts:253
- **C19:** skill-registry.ts:150; scheduling-mutations.ts:143; reschedule-proposals.ts:167-168,222,308; scheduling-catalog.ts:98-116
- **C20:** scheduling-batch.ts:27-58,133,141-144; secretary-action-plan.ts:14-16
- **C21:** skill-registry.ts:218-220; secretary-same-as.ts:38-40; appointment-service.ts:1343-1377; secretary-scheduling-actions.integration.test.ts:211
- **C22:** waitlist.ts:304; api/waitlist/join/route.ts:82; agenda/flexible-actions.ts; scheduling-mutations.ts:125
- **C23:** actions.ts:54,675; visit-scheduling.ts:426; scheduling-actions.ts:63-69
- **C24:** availability-block-domain.ts:9-21,27; scheduling-mutations.ts:102-109,138
- **C25:** availability-panel.tsx:30-67; scheduling-contract.ts:22; skill-registry.ts:56; scheduling-mutations.ts:106; prática B09
- **C26:** actions.ts:928-961; skill-registry.ts:60; secretary-instruction-contract.test.ts:27-31
- **C27:** availability-actions.ts:81,107; scheduling-skill.ts:172; secretary-scheduling.test.ts:18
- **C28:** profissionais/actions.ts:239; team-hours-actions.ts:18,52; skill-registry.ts:60
- **C29:** secretary-scheduling.ts:288-296 (>50 antes do filtro de período); page.tsx; agenda-board.tsx
- **C30:** scheduling-catalog.ts:72-90; secretary-scheduling.ts:265-266; scheduling-contract.ts:22
- **C31:** visit-scheduling.ts:238-300; api/availability/route.ts:59-68; secretary-scheduling.ts:194
- **C32:** scheduling-catalog.ts:154; scheduling-contract.ts:22; secretary-scheduling.ts:288; bank.json:514-519 S074
- **C33:** appointment-events.ts:119; communication-skill.ts:10-18; same-as.ts:36-44; secretary-same-as-runtime.test.ts:337-349
- **C34:** api/cron/reminders/route.ts; actions.ts:494
- **C35:** schema.prisma:1549-1575; scheduling-catalog.ts:77-78,108; secretary-scheduling-actions.integration.test.ts:229
- **C36:** scheduling-catalog.ts:44-63; skill-registry.ts:20; page.tsx:55-62; schema.prisma:1008
- **X01:** availability-block-domain.ts:7-21
- **X02:** scheduling-mutations.ts:58; secretary-b7-presentation.test.ts:87
- **X03:** actions.ts:582,197; same-as.ts
- **X04:** actions.ts:60-63,665-666; scheduling-catalog.ts:98-116
- **X05:** scheduling-contract.ts:22; agenda page.tsx (visão semana)
