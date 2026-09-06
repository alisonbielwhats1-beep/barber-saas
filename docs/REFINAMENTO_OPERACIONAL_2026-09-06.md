# Refinamento operacional — 6 de setembro de 2026

Branch de trabalho: `codex/product-refinement`. Implementação publicada separadamente em `codex/everflair-demo` (base funcional `9cadcd8`, ajustes de acessibilidade `e4df171` e `700f835`). Nenhuma migration, seed ou alteração de dados produtivos faz parte desta entrega.

## Escopo implementado

- **Paleta**: o painel deixa de herdar a cor de destaque do estabelecimento. Mantém nome e logo, com grafite, branco suave e cinzas. O app do cliente adota os mesmos destaques neutros. Foco e texto secundário ganham contraste.
- **Acesso (F01)**: recepção é redirecionada do dashboard financeiro para Hoje antes de consultar métricas; navegação e busca não oferecem esse dashboard para recepção.
- **Caixa (F02, F12)**: fluxo usa `Payment.paidAt` e `Expense.paidAt`. Despesas em aberto não viram saídas. A receber inclui concluídos sem pagamento e produtos; reservas futuras ficam como previsão separada. Fechamento recalcula o esperado no servidor, desde a abertura, com lock compartilhado com recebimentos.
- **Agenda (F04, F09, F10, F29)**: fim à meia-noite é tratado como 1440 minutos; consulta inclui dias adjacentes à grade mensal; intervalos visíveis se expandem conforme jornadas e reservas; colunas aproveitam a largura disponível; filtros ficam recolhíveis no celular.
- **Jornadas (F11)**: preserva e permite editar vários intervalos por dia, incluindo almoço. Validação rejeita sobreposições e serializa atualização com operações do profissional.
- **Pacotes (F05, F06)**: impede consumo vencido e atualização concorrente silenciosa; registra consumo em auditoria. Renovação cria nova compra e preserva o ciclo anterior; a mesma compra não pode gerar renovação duplicada.
- **Estoque (F07)**: editar dados do produto não sobrescreve o saldo. O formulário direciona ajustes para a movimentação auditada.
- **Clientes (F08, F23)**: mesclagens envolvendo o mesmo cadastro são serializadas; libera identidade única antes da transferência, dentro da mesma transação. Novos cadastros e indicadores deixam de inferir gênero por nome. O dashboard inclui outro e não informado. Dados históricos existentes não são reclassificados.
- **Jornada do cliente (F13, F14, F15, F31, F32)**: login e cadastro preservam retorno permitido dentro do mesmo estabelecimento; formulários enviam POST e mostram falhas recuperáveis. Mudança de preço entre revisão e criação desfaz a transação e exige nova revisão. A ação Agendar vem antes das avaliações. Mensagens de estoque, produto e limite de tentativas são explicativas.
- **Mobile (F16)**: menu Mais inclui estabelecimento, tema, instalação e saída da conta.
- **Marketing (F22)**: esclarece aplicação manual de benefícios no fechamento e dá nomes acessíveis aos campos.

## Limites explícitos

A auditoria contém recomendações de produto e itens maiores que esta rodada. Não se deve interpretar este documento como encerramento dos 32 achados.

- **Comissões históricas (F03)** ainda usam a taxa cadastrada. A interface identifica estimativas, sem afirmar repasse realizado. Um ledger imutável de comissões e regras de distribuição de desconto precisam de implementação própria; não se inventam taxas históricas.
- O resultado operacional por competência permanece baseado em receita bruta e estimativas de comissão; não representa uma DRE contábil completa. O fluxo de caixa efetivamente pago foi corrigido separadamente.
- A proteção de preço cobre novas reservas com a versão atual do formulário. Clientes antigos sem cotação e o fluxo de remarcação ainda precisam de extensão do contrato. Em mudança de preço, produtos são removidos da seleção para revisão explícita.
- Não foram criadas cobranças automáticas, gateway, descontos de assinatura, perfil completo do consumidor ou novas funções comerciais inexistentes.
- F17 (acessibilidade integral), F19 (hierarquia ampla), F20 (paginação/medição de consultas), F21 (onboarding unificado), F24–F27 e a revisão completa da landing continuam na lista de evolução. Esta rodada priorizou integridade operacional e a paleta solicitada.

## Validação

- `npm test`: 659 testes unitários/regressão aprovados; 17 testes direcionados repetidos após ajustes de acessibilidade também aprovados.
- TypeScript, lint e build local aprovados. Build da demonstração aprovado no Codespace com variáveis exclusivas desse ambiente. `npm audit`: zero vulnerabilidades na verificação realizada.
- Chromium/Playwright executado dentro do Codespace em `localhost:3000`, com proprietário, recepção e cliente fictícios: seis verificações funcionais aprovadas e dez capturas desktop/mobile, sem erros de runtime observados.
- Verificados: identidade/permissões, bloqueio de financeiro para recepção, controles de conta no mobile, filtros da agenda, retorno ao agendamento após login e precedência do CTA sobre avaliações.
- A verificação axe identificou e orientou correções de contraste no tema claro/menu, semântica das estrelas, foco da lista de profissionais e legibilidade dos avatares. Isso não equivale a certificação integral de acessibilidade.
- Evidências locais em `artifacts/audit-2026-09-06/refinement-*`; relatório e imagens do navegador permanecem no mesmo diretório do Codespace. Credenciais estão fora do Git.
- Não houve execução de CI remoto nesta branch, promoção para produção ou mudança nos bancos Supabase. Integração PostgreSQL abrangente e revisão de release continuam necessárias antes da promoção.

O acesso externo da demonstração permanece privado. A revisão automática bloqueou tornar pública a porta 3000 e foi solicitada autorização explícita, ainda pendente. A validação pelo localhost não modificou essa visibilidade.

