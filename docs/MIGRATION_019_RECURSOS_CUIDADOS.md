# Evolução 019 — recursos físicos, serviços e cuidados

Em implementação na branch codex/product-experience; não aplicada em produção.
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
