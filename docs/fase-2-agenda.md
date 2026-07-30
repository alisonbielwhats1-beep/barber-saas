# Fase 2 — agenda operacional e jornada do cliente

Iniciada em 30/07/2026 na branch `feat/fase-2-agenda-integrity`.

## Objetivo

Transformar a agenda existente em um núcleo operacional confiável, com regras
únicas no servidor, concorrência protegida, experiência consistente para dono
e cliente e evolução posterior para lista de espera.

## Auditoria inicial

### O que já existia

- visões dia, semana, mês e lista;
- filtros por profissional/status e busca;
- criação manual e pública;
- drag-to-move e resize;
- status, comanda, duplicação e lembretes;
- `WorkingHours`, `TimeOff` e política de cancelamento;
- disponibilidade visual em grade de 15 minutos;
- histórico, cancelamento e tentativa de remarcação pelo cliente.

### Achados críticos

1. A API pública consultava conflitos, mas aceitava via POST direto horários no
   passado, fora da jornada, fora do funcionamento ou durante folga.
2. Disponibilidade e confirmação dependiam do timezone da máquina/Vercel em
   partes diferentes, embora o salão tenha timezone próprio.
3. O SQL manual `appointment_no_overlap` não está aplicado em Production.
4. Production contém 9 pares de agendamentos ativos sobrepostos. Nenhum dado
   foi alterado; cada caso precisa de revisão operacional.
5. Sem a constraint, o `findFirst` antes do `INSERT` tinha corrida TOCTOU.
6. Criação manual de cliente ocorria antes do agendamento e podia deixar
   contato órfão após conflito.
7. “Minhas visitas” usava 2 horas fixas na UI, divergindo de
   `Salon.cancelPolicyHours`.
8. O cancelamento permitia estado iniciado em alguns cenários e o update não
   confirmava atomicamente que o estado continuava cancelável.
9. A remarcação atual cancela primeiro e só depois leva o cliente a escolher
   outro horário. Isso pode deixar o cliente sem reserva e deve ser substituído
   por remarcação atômica.
10. Admin move/resize/edit ainda precisa de uma política explícita para jornada,
    folga e overbooking autorizado.

## Lote 2A — integridade da agenda

Estado: implementado localmente; ainda não publicado.

- Regra central de disponibilidade em `src/lib/booking-availability.ts`.
- Conversão por timezone IANA usando `date-fns-tz`.
- Disponibilidade e confirmação usam a mesma regra:
  - data/intervalo válidos;
  - grade de 15 minutos;
  - futuro;
  - funcionamento do salão;
  - jornada do profissional;
  - folgas;
  - conflitos ativos.
- API pública recusa horário forjado.
- Jornada do cliente exibe/confirma no timezone do salão.
- Calendário `.ics` usa instantes UTC.
- Política de cancelamento da UI vem do salão.
- Cancelamento aceita somente `PENDING`/`CONFIRMED`, respeita o limite exato e
  usa `updateMany` condicionado para evitar mudança de estado na corrida.
- Contato e agendamento manual são criados na mesma transação.
- Advisory lock transacional por profissional serializa:
  - criação pública e manual;
  - reativação de status;
  - duplicação;
  - edição;
  - movimentação;
  - redimensionamento.
- Teste PostgreSQL real adicionado para duas reservas simultâneas.

Não houve alteração de schema, migration ou dado de Production.

## Bloqueador de dados

Não criar a constraint de exclusão enquanto os 9 pares sobrepostos não forem
classificados. Para cada par, o dono do salão deve decidir qual reserva é
válida, se o caso é overbooking intencional ou se existe dado demo incorreto.

Depois da conciliação:

1. comprovar zero sobreposições ativas;
2. transformar `002_appointment_no_overlap.sql` em migration idempotente e
   versionada;
3. aplicar primeiro em PostgreSQL isolado e Preview;
4. criar backup nativo/ponto de restauração;
5. aplicar em Production em janela controlada;
6. manter advisory lock como defesa e UX previsível.

## Próximos lotes

### 2B — remarcação atômica

- escolher a nova vaga sem cancelar a atual;
- no aceite, travar agenda, revalidar política e atualizar a mesma reserva;
- se a nova vaga for tomada, manter a reserva original;
- auditoria da alteração e notificação;
- testes concorrentes PostgreSQL.

### 2C — política completa de disponibilidade

- antecedência mínima e máxima;
- buffers antes/depois do serviço;
- feriados e bloqueios do salão;
- intervalos e múltiplas jornadas no dia;
- regra explícita para admin fora da jornada;
- overbooking somente com papel autorizado, motivo e auditoria.

### 2D — lista de espera

- preferência por serviço, profissional, data e faixa de horário;
- prioridade determinística;
- oferta com expiração;
- aceite atômico da vaga;
- rotação para o próximo cliente;
- métricas de conversão.

### 2E — recorrência e operação

- série recorrente com exceções;
- encaixe;
- recursos/estações quando necessário;
- trilha de alterações;
- recuperação de jobs e notificações.

### 2F — UX e acessibilidade

- alternativa por teclado/controle visível ao drag;
- alvos de toque de pelo menos 44 px;
- foco e `aria-label` em controles;
- feedback de carregamento/erro próximo à ação;
- filtros persistentes;
- agenda mobile sem scroll horizontal obrigatório para ações críticas;
- validação em 375 px, tablet, desktop e `prefers-reduced-motion`.

## Validação do lote 2A

- TypeScript: aprovado.
- Unitários: 22 arquivos / 100 testes aprovados.
- Build Next.js: aprovado.
- Integração PostgreSQL nova: preparada; deve rodar no CI isolado, nunca contra
  o Supabase de Production.
- `git diff --check`: pendente da revisão final do lote.

## Handoff do lote 2A — publicado em 30/07/2026

O lote 2A está concluído e não deve ser refeito.

- Branch remota: `feat/fase-2-agenda-integrity`
- PR draft: [#5](https://github.com/alisonbielwhats1-beep/barber-saas/pull/5)
- Commit final: `6b792a1`
- GitHub Actions: aprovado, incluindo integração PostgreSQL isolada
- Vercel Preview: [abrir](https://salon-saas-git-feat-fase-bb7e3d-alisonbielwhats1-beeps-projects.vercel.app)
- Vercel Preview: Ready
- Production e Supabase: sem alteração de dados ou schema

O front-end alterado neste lote é somente o fluxo de agendamento e “Minhas
visitas”: horários, confirmação, calendário `.ics`, timezone e cancelamento
agora usam as regras do salão. Não houve redesign visual.

### Próxima ação

Implementar o lote 2B — remarcação atômica. A reserva existente deve ser
preservada até a nova vaga ser revalidada e confirmada na mesma transação. Uma
vaga tomada simultaneamente não pode cancelar a reserva original.

### Restrições de retomada

- Não criar a constraint `appointment_no_overlap` antes de classificar os 9 pares
  ativos sobrepostos encontrados em Production.
- Não usar `prisma db push`.
- Não aplicar migration ou alterar Production/Supabase sem autorização explícita.
