# Evolução 019 — recursos físicos, serviços e cuidados

Implementada na branch codex/product-experience; não aplicada em produção.
Autorização: realizar as pendências da auditoria e validar mudanças de banco no GitHub.

O incremento adiciona recursos físicos com reserva exclusiva por intervalo,
variantes/etapas de serviços, dependentes vinculados ao titular, anotações e
fotos privadas por visita e pedidos flexíveis de lista de espera.

Somente PostgreSQL 16 descartável do schema-smoke, identificado como
salon_schema_ci. Não executar SQL nos projetos Supabase existentes.

Antes de aplicar: preflight somente leitura, backup e restauração de dados
fictícios. Depois: reaplicação, preservação de registros, constraints, RLS,
concorrência e jornadas autenticadas. Rollback conserva tabelas e dados novos;
voltar o código sem apagar histórico. As reservas de recursos permanecem
protegidas por constraints e triggers mesmo durante rollback de aplicação.

Fotos de cuidados não usam o bucket público de marketing: conteúdo privado,
limitado e normalizado, servido somente após autorização sobre o atendimento.
Não há fornecedor pago nem envio automático de WhatsApp/SMS.

## Evidências no GitHub

Os runs `34070676523` (`a16055b`) e `34071775481` (`87f4ccb`) passaram pela
aplicação/reaplicação 019, preservação dos dados anteriores, restauração do backup,
constraints/RLS e 7 testes PostgreSQL específicos. O primeiro run encontrou
falhas visuais e de seletores no navegador; não é uma homologação integral.
Os resultados integrados por versão ficam nos checks do PR #79.
O run `34071775481` passou integralmente, incluindo as jornadas autenticadas e
os rollbacks não destrutivos. Evidência:
https://github.com/alisonbielwhats1-beep/barber-saas/actions/runs/34071775481.

Os testes cobrem reserva concorrente de recurso, liberação no cancelamento,
rollback do reagendamento em conflito, preservação do recurso histórico e
aposentadoria da alocação após troca de serviços, fila FIFO concorrente,
propriedade do dependente, autorização de cuidados e isolamento entre tenants.
Runtime de teste usa `app_runtime` sem BYPASSRLS. Nenhum teste usa Production.
