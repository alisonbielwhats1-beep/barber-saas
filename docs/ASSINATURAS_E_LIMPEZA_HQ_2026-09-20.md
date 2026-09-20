# Assinaturas e limpeza do HQ — candidata de 20/09/2026

Implementação autorizada após auditoria somente leitura. Branch
`codex/billing-selection-tenant-removal`. Não publicada em Production.

## Diagnóstico e correção

Uma contratação pendente escondia o catálogo e o painel de troca exigia período
pago, sem explicar o impedimento. O catálogo agora permite comparar e selecionar
outro plano antes do primeiro pagamento. A confirmação solicita o cancelamento
existente; somente depois da confirmação de toda a cadeia no Mercado Pago fica
disponível o botão da nova contratação. Valores, idempotência, vínculo de tenant,
validação de capacidade e proteção contra duas assinaturas continuam no backend.
Uma confirmação de pagamento concorrente impede a contratação duplicada.

Para assinatura paga, a cotação continua em `createChangeQuote` e a confirmação em
`confirmPlanChange`. A seleção começa no ciclo e capacidade atuais. Nenhuma regra
proporcional foi recriada: upgrade recebe a diferença e mantém vencimento;
redução/troca de ciclo respeita a renovação e o pagamento correspondente.

Checkout ganhou orientação para usar comprador diferente do recebedor e mensagens
de erro compreensíveis. Isso não contorna recusas do provedor nem muda ambiente,
credenciais ou parâmetros financeiros. A causa específica da recusa relatada não
foi comprovada por um código de erro do checkout. Não foram feitas compras reais.
Testes externos devem usar staging isolado, vendedor e comprador fictícios distintos.

## Exclusão e histórico

HQ tem atalho explícito para Estabelecimentos e histórico. O administrador global
pode mover cadastros suspensos/recusados para o histórico e restaurar a lista.
Arquivar não muda acesso, cancela cobranças ou apaga dados. A trilha reutiliza
`hq_activities` append-only e o controle de acesso `withHq` existente.

Exclusão definitiva exige SUPER_ADMIN revalidado na transação, acesso suspenso ou
recusado e digitação do slug exato. Uma consulta às FKs reais do banco bloqueia
qualquer vínculo, inclusive clientes, assinaturas canceladas, atendimentos,
serviços, profissionais, auditorias operacionais e tabelas futuras. As únicas
exceções são vínculo OWNER, horários de configuração e decisões administrativas;
estas decisões são copiadas para a auditoria independente do HQ antes da exclusão.
Membros de equipe bloqueiam a operação. Contas `User` não são excluídas.

O servidor repete a inspeção sob lock de billing e `FOR UPDATE` do estabelecimento,
serializando inserções concorrentes com FK. Erro de permissão, tabela ou consulta
reverte a operação; não é interpretado como cadastro vazio. Nenhuma RLS é removida,
nenhuma role de runtime ganha privilégios e não há migration nesta entrega.

O responsável identificou seu cliente ativo e a conta de demonstração como dados
a preservar. Nenhum estabelecimento real foi arquivado ou excluído nesta tarefa.

## Validação

Testes de componentes verificam seleção pendente, confirmação de cancelamento,
bloqueio de exclusão com clientes, digitação exata e confirmação de histórico.
Testes de domínio incluem usuário comum, cadastro ativo e vínculos futuros.
Integração PostgreSQL no schema-smoke exercita role NOBYPASSRLS, exclusão de cadastro
sintético vazio, preservação de usuário/cliente e restauração do histórico.
Resultados finais de lint, TypeScript, unitários, build e CI serão registrados no PR.
Não usar Production para testar exclusão. Promoção depende de aprovação.
