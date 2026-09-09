# Expediente, pausas e agendamento — 09/09/2026

Base: `9f4ee3d` / `master`. Branch: `codex/fix-scheduling-hours`.

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
- Aplicação conjunta salva a referência do salão e os intervalos selecionados na
  mesma transação. Preserva os dias de folga, exige revisão explícita, valida papel
  e tenant no servidor e registra antes/depois na auditoria.
- Profissionais aponta para esse mesmo local; ajustes individuais continuam possíveis.
- Novos dias no editor individual começam com a referência atual do salão.
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

A correção de configuração acima já foi aplicada. A nova interface ainda depende
de CI/Preview e promoção explícita do código para produção.
