# Expediente, pausas e agendamento — 09/09/2026

Base: `9f4ee3d` / `master`. Branch: `codex/fix-scheduling-hours`.

## Confirmação posterior e pausas recorrentes

O responsável corrigiu a abertura para **09h** (fechamento 21h, pausa 12h30–15h).
A correção produtiva foi aplicada somente ao tenant identificado e aos dois
profissionais, preservando folgas, bloqueios e os 46 agendamentos atuais por
checksum. Novo backup/rollback privado e AuditLog
`schedule-opening-correction-2026-09-09-martinelli`. Isso substitui os 06h do
registro histórico a seguir; não reaplicar o primeiro reparo.

A agenda oferece “Pausa recorrente” para subtrair um intervalo da jornada nos
dias escolhidos, sem data final. Preserva outras pausas, folgas e horários fora
dos dias selecionados. Seleção de toda a equipe abrange os profissionais atuais;
novos profissionais continuam exigindo jornada própria. Expedientes adicionais
por data continuam como exceções explícitas. Para encurtar/remover uma pausa, o
atalho leva ao editor central de jornadas, evitando restaurar disponibilidade
que já estava bloqueada por outra razão.

Revisão mostra antes/depois por profissional e dia. Servidor verifica papel e
tenant e exige hash da configuração e pedido revisados, revalidado sob lock;
alteração concorrente exige nova revisão. Nenhuma reserva é cancelada/remarcada.

“Bloquear horário ou dia” mantém bloqueio pontual e recorrências anteriores,
adicionando dias da semana até data final inclusiva. Expansão usa datas civis no
fuso do salão e limita o pedido real a 200 bloqueios. Revisão mostra quantidade,
primeiro/último período e reservas afetadas. Operações permanecem idempotentes.
Em Configurações, “Novo bloqueio” vira “Fechar um dia”, com botão arredondado e
indicação explícita de que almoço recorrente é configurado na agenda.

Novos testes cobrem segunda a sexta, fins de semana, folgas, intervalos já
existentes, limite de expansão, DST, revisão obsoleta, papéis, tenant e falhas.
E2E usa banco descartável, API real e formulários em 390px/1440px; screenshots
recebem identificação “AMBIENTE DE TESTES · DADOS FICTÍCIOS”. Não são cadastros
do Martinelli. Sem migration ou publicação produtiva da interface nesta etapa.

## Diagnóstico e correção operacional

A leitura autorizada identificou uma referência de salão 09h–22h, mas jornadas
individuais 09h–18h. A referência geral não altera as jornadas: o motor consulta
WorkingHours e ProfessionalOpening, preservando bloqueios, folgas e conflitos.
Um serviço de 3h30 iniciado às 16h15 termina às 19h45 e era corretamente recusado
pelo limite individual das 18h. A interface não explicava suficientemente essa relação.

Após confirmação do responsável, o tenant solicitado foi ajustado para 06h–21h,
com intervalos 06h–12h30 e 15h–21h para ambos os profissionais. Dias de trabalho,
folgas, bloqueios e reservas foram preservados. Preflight somente leitura, backup
local privado, rollback condicional e backup antes/depois no AuditLog precederam
a escrita transacional. Locks compatíveis com o motor e comparação da configuração
anterior impedem sobrescrever alterações concorrentes. Os 44 agendamentos permaneceram
idênticos por checksum. Um atendimento futuro coincide com a nova pausa e deve ser
revisado pela equipe; nenhum cliente foi contatado ou remarcado automaticamente.

Não houve migration, mudança de autenticação/RLS ou uso de dados reais em testes.
Os arquivos de recuperação permanecem em `artifacts/`, fora do Git.

## Interface e regras

- Configurações → Agenda concentra expediente, pausas e jornadas individuais.
- O horário geral do estabelecimento pode ser salvo isoladamente e não altera
  jornadas individuais. Nenhum profissional vem selecionado por padrão.
- Copiar o horário geral para a equipe é uma ação separada e opcional. Ela exige
  ativação explícita, seleção nominal e revisão do antes/depois; a interface avisa
  que horários especiais e pausas diferentes serão substituídos.
- Aplicação conjunta salva a referência do salão e os intervalos selecionados na
  mesma transação. Preserva os dias de folga, exige revisão explícita, valida papel
  e tenant no servidor e registra antes/depois na auditoria.
- Profissionais aponta para esse mesmo local; ajustes individuais continuam possíveis.
- Novos dias no editor individual começam com a referência atual do salão.
- Na visão diária, intervalos fora da jornada e entre turnos recebem tracejado e
  o rótulo “Fora do expediente”. Bloqueios cadastrados continuam identificados
  separadamente como “Bloqueado”. Essa apresentação é igual para dono/gerente;
  profissionais continuam vendo apenas a própria agenda por regra de acesso.
- O formulário de políticas deixa de sobrescrever horários com valores desatualizados.
- Salvar jornada invalida também as páginas do cliente, configurações e operação.
- A remarcação mostra duração e término previsto no fuso do salão, explica quando
  o intervalo completo não cabe e preserva os campos quando houver falha de rede.
- A seleção pública explica que a duração, pausa e jornada limitam o último início.
- Expedientes adicionais por data e bloqueios continuam explícitos na Agenda.

## Verificação

Regressões sintéticas cobrem jornada antiga, 06h–21h, pausa 12h30–15h, serviço de
3h30, meia-noite, folgas, reservas, buffer, fechamentos, recursos, isolamento e
permissões. Testes DOM cobrem revisão, edição posterior e falha/retry.
E2E no banco descartável salva pelo formulário mobile, consulta a disponibilidade
real da API e confere desktop/mobile com axe. Resultados finais serão registrados
nos checks da branch; não usar produção para executar esses testes.

A auditoria de dependências encontrou seis alertas preexistentes (um crítico,
dois altos, três moderados): Next/sharp, js-yaml e ferramentas Vitest. Nenhuma
dependência foi adicionada nesta correção. Atualizações de segurança exigem uma
entrega própria com validação; não considerar a auditoria aprovada/zerada.

A correção de configuração e a interface descrita originalmente foram publicadas
pelo PR #84. A separação posterior entre horário do salão e cópia opcional para
a equipe, junto da indicação visual de períodos indisponíveis, teve sua publicação
autorizada pelo responsável pelo produto.
