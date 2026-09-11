# Agente Chefe — piloto de leitura
Pedido de 11/09/2026: concluir laboratório e conectar Chefe aos dados do HQ,
modelo e histórico persistente com orçamento. Laboratório b09d4ec validado
no CI 34553915666 (check/schema-smoke/Preview aprovados). Ainda não publicado.

## Auditoria e arquitetura
Reutilizar withHq (NextAuth SUPER_ADMIN + papel no banco + GUC/RLS), consultas
financeiras do dashboard, componentes e workspace SDK. Nenhum acesso aos
cadastros de clientes finais, serviços ou reservas de salões. Sem vínculo
account–salon necessário nesta entrega: usa somente o CRM interno existente.
Ausência de telemetria significa que o Chefe não pode afirmar uso do produto.

Fluxo: autorização -> validação -> snapshot limitado -> reserva atômica ->
transação encerrada -> uma chamada Luna/SDK -> persistência -> resposta.
Perguntas independentes, sem memória enviada. Histórico é consulta local.
A IA recebe somente números, estabelecimento truncado, status e datas;
nenhum telefone, e-mail, observação, descrição de ticket ou secret.
Os links de fontes são construídos pelo servidor; saída exibida como texto.

## Banco proposto e conflitos
Migration manual 022 aditiva: hq_agent_runs com UUID, actorId FK User RESTRICT,
pergunta/resposta, snapshot JSON, fontes, status, modelo/versão, usage e reserva
em micros de USD. Índices por data e ator/data. RLS ENABLE/FORCE, só contexto
HQ administrativo; sem grants anon/authenticated/PUBLIC, sem DELETE runtime.
Não pertence ao histórico Prisma: seguir o mecanismo manual existente.
Preservar migrations 008–021; nenhuma é reaplicada em produção.

## Controles
HQ_CHIEF_ENABLED=false por padrão. Exige OPENAI_API_KEY, migration verificada
e HQ_CHIEF_MONTHLY_USD entre 1 e 20; ausência/configuração inválida bloqueia.
Modelo fixado gpt-5.6-luna e prompt versionado; uma chamada, sem tools externas,
sem retries automáticos, 45s de timeout, até 1200 tokens de saída, entrada
UTF-8 até 40KB. Sem traces exportados, store=false, sem reasoning persistido.
Tabela registra snapshot utilizado e resposta, acessíveis só ao administrador.

Reserva conservadora US$0,025 por pergunta sob advisory transaction lock
global, antes do consumo. Estimativa reconciliada com usage, sem desconto
de cache e margem de 25% na entrada. Preços de referência 11/09/2026:
US$0,20/M entrada e US$1,20/M saída (Luna, contexto curto); revisar antes de
trocar modelo/preços. Valor estimado da aplicação não substitui fatura OpenAI.
Limite global de 20 tentativas/dia UTC e uma execução ativa de cada vez.
UUID identifica solicitação: repetição não consome novamente. Falha/timeout/
processo interrompido mantém reserva integral; não assumir consumo zero.
Após 90s, execução ativa abandonada vira falha, conservando reserva.
Histórico mantém no máximo 30 execuções por página; navegação por cursor.
Não há limpeza destrutiva automática; retenção deve ser revisada com volume.

## Validação e ativação
Testes usam PostgreSQL descartável e transporte de IA falso. Nunca testar
dados produtivos. CI aplica/preflight/reaplica/verifica 022, testa RLS,
concorrência, replay, orçamento, falhas, snapshot e preservação; build/lint/
tipos/unitários/navegador. Nenhuma credencial de IA no CI/Preview.
Ativação real exige chave no servidor e teto escolhido pelo responsável.
Antes da migration produtiva: confirmar projeto, preflight read-only,
backup criptografado/restaurável, autorização da publicação e inventário.
Rollback: desativar HQ_CHIEF_ENABLED e voltar código; manter tabela/histórico.
Não apagar tabela ou reservas para reabrir orçamento.

Fontes:
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/guides/agents
- https://supabase.com/docs/guides/database/postgres/row-level-security
