# Próximas fases — ordem prática

Este plano substitui a ambiguidade entre as “7 fases” históricas do painel e o
programa atual do produto. O roadmap antigo registra entregas visuais já
existentes; as fases abaixo organizam o trabalho daqui para frente.

## Resumo de prioridade

| Ordem | Fase | Eixo | Criticidade |
|---|---|---|---|
| — | Pendência 1E | Ativar convites por e-mail | Alta, mas isolada |
| 2 | Agenda operacional e jornada do cliente | Produto/lógica/UX | Crítica |
| 3 | Multi-tenant, dados e arquitetura | Segurança/arquitetura | Crítica |
| 4 | Backend e regras comerciais | Lógica/API | Alta |
| 5 | Frontend e design system | Visual/acessibilidade | Alta |
| 6 | DevOps, observabilidade e recuperação | Infra/operação | Crítica |
| 7 | Billing e monetização | Receita | Alta |
| 8 | Operação, suporte e compliance | Empresa/processos | Alta |
| 9 | IA e automações | Eficiência | Média |
| 10 | Escala e expansão | Plataforma | Média, depois das anteriores |

## Pendência 1E — convites por e-mail

Pode ser executada em paralelo, mas não bloqueia a Fase 2.

- verificar domínio no Resend;
- configurar e testar primeiro em Preview;
- validar criar, entregar, reenviar, revogar e aceitar;
- ativar em Production somente após evidências;
- monitorar falhas sem expor token, hash ou PII.

Não exige nova migration. O checklist completo está em
`docs/fase-1-rollout.md`.

## Fase 2 — agenda operacional e jornada do cliente

Objetivo: tornar a agenda confiável para uso diário e competitiva com produtos
como Booksy, sem copiar interface ou regras proprietárias.

1. Auditar o que já existe e cobrir lacunas com testes.
2. Implementar lista de espera por serviço, profissional e faixa de horário,
   com prioridade, expiração, oferta de vaga e aceite atômico.
3. Regras de disponibilidade: duração, buffer, intervalo, folga, feriado,
   bloqueio, antecedência mínima/máxima, timezone e capacidade.
4. Garantir que criação, remarcação e drag-and-drop não produzam conflito em
   corrida simultânea.
5. Agendamentos recorrentes, encaixe/overbooking somente com permissão e trilha
   de auditoria.
6. Fluxo completo de confirmar, concluir, cancelar, no-show e reagendar.
7. Cliente: repetir visita, adicionar ao calendário, cancelar/remarcar dentro
   da política e acompanhar lista de espera.
8. Agenda mobile-first, atalhos de teclado, filtros persistentes, estados
   vazios/erro/carregamento e acessibilidade.
9. Métricas: ocupação, no-show, tempo ocioso, conversão da lista de espera.

Gate: testes PostgreSQL de concorrência, smoke E2E das jornadas e validação com
um dono de salão usando dados de demonstração.

## Fase 3 — multi-tenant, dados e arquitetura

1. Inventariar toda consulta por tenant e impedir acesso sem `salonId`.
2. Testar cross-tenant em API, actions, uploads, relatórios e jobs.
3. Planejar RLS como defesa em profundidade sem quebrar Prisma/pooling.
4. Criar baseline confiável de migrations para novos ambientes.
5. Resolver o drift de precisão de `Appointment` por migration própria.
6. Definir estratégia de conexão Supabase: pooler para runtime e conexão direta
   para migrations, sem `db push`.
7. Índices, planos de execução, retenção, anonimização e política de exclusão.
8. Seletor de salão para usuários com múltiplos memberships.

Gate: testes com dois salões reais de fixture, restore ensaiado e migrations
aplicáveis do zero e sobre Production.

## Fase 4 — backend e regras comerciais

1. Padronizar autenticação, autorização, validação e erros das APIs/actions.
2. Idempotência para escritas críticas, webhooks e jobs.
3. Políticas de cancelamento, taxa de no-show, comissão e consumo de pacotes.
4. Estoque e financeiro com transações e trilha auditável.
5. Jobs de lembrete com retry, deduplicação e dead-letter/reprocessamento.
6. Contratos de API, paginação, limites e testes de regressão.
7. Revisar rate limits por risco e carga real para não bloquear uso legítimo.

Gate: suíte de integração PostgreSQL e testes de contrato sem mocks como única
evidência.

## Fase 5 — frontend e design system

1. Consolidar tokens, tipografia, cores, espaçamento e componentes.
2. Uniformizar painel, app do cliente, formulários, tabelas, calendários,
   drawers e modais.
3. WCAG: teclado, foco, contraste, labels, leitores de tela e redução de
   movimento.
4. Responsividade real em celular, tablet e desktop.
5. Mensagens de erro acionáveis, confirmações, skeletons e prevenção de ação
   duplicada.
6. Onboarding guiado de salão, serviços, equipe e horários.
7. Performance: bundle, imagens, cache e Core Web Vitals.

Gate: auditoria visual nas principais resoluções, Lighthouse e jornadas E2E.

## Fase 6 — DevOps, observabilidade e recuperação

1. Separar claramente Development, Preview e Production.
2. Backups nativos do Supabase e teste periódico de restauração.
3. Monitorar erros, latência, 429/503, jobs, Redis, banco, storage e e-mail.
4. Alertas com responsáveis, runbooks e níveis de severidade.
5. Proteção de branch, revisão obrigatória, CI e deploy com rollback.
6. Rotação de segredos e inventário de acessos.
7. Custo, capacidade e limites de Vercel, Supabase, Upstash e provedores.

Gate: restore ensaiado, incidente simulado e observabilidade sem dados
sensíveis.

## Fase 7 — billing e monetização

1. Definir planos, limites, trial, upgrade/downgrade e inadimplência.
2. Integrar provedor de pagamentos por webhooks idempotentes.
3. Ledger/auditoria de cobrança; nunca confiar no estado enviado pelo cliente.
4. Portal de cobrança, notas/recibos, cancelamento e reativação.
5. Aplicar entitlements no servidor, não apenas esconder UI.
6. Métricas de MRR, churn, trial e conversão.

Gate: sandbox completa, reconciliação de eventos e testes de corrida/replay.

## Fase 8 — operação, suporte e compliance

1. Onboarding e checklist de implantação por salão.
2. Painel interno de suporte com acesso mínimo e auditoria.
3. Termos, privacidade, LGPD, consentimento e direitos do titular.
4. Exportação/exclusão de dados com preservação legal do necessário.
5. Gestão de incidentes, SLA, suporte e base de conhecimento.
6. Isolar/remover tenants e credenciais demo antes de clientes reais.

Gate: operação de um cliente piloto sem acesso manual direto ao banco.

## Fase 9 — IA e automações

Somente depois de dados, consentimento e operação estarem confiáveis.

1. Casos com ROI: resumo de agenda, sugestão de horários, campanhas e previsão
   de no-show.
2. Aprovação humana para mensagens e ações com impacto.
3. Redação/minimização de PII, logs seguros e política de retenção.
4. Avaliação de qualidade, custo, fallback e prevenção de prompt injection.
5. Nunca permitir que IA contorne autorização multi-tenant.

Gate: avaliação offline, limites de custo e desligamento imediato por flag.

## Fase 10 — escala e expansão

1. White-label, domínios próprios e múltiplas unidades.
2. Recursos/estações, permissões avançadas e franquias.
3. Estratégia de cache, filas e particionamento baseada em métricas reais.
4. Localização, moedas, fusos e regras regionais.
5. APIs/integrações públicas com OAuth, quotas e auditoria.
6. Plano de migração para Supabase Pro sem mudança de aplicação:
   capacidade, backups/PITR, observabilidade e limites são configuração; evitar
   dependência de recursos exclusivos sem adaptador.

Gate: testes de carga, orçamento de capacidade e rollout progressivo.

## Regra para começar qualquer fase

1. Ler `docs/STATUS_ATUAL.md`.
2. Confirmar branch limpa e CI verde.
3. Auditar o comportamento atual antes de implementar.
4. Criar critérios de aceite e testes de regressão.
5. Fazer migration apenas quando necessária, com backup e rollback.
6. Entregar em branch/PR, validar Preview e só então promover a Production.
