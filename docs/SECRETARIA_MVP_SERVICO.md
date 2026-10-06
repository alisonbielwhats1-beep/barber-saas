# MVP técnico: rascunho → proposta → cadastro de serviço

Base exigida pelo responsável: `9b92138ec7665342b60e1ddc210f04ccfa611c84`.
Branch local: `codex/service-create-mvp`. Somente F1/F2 do primeiro fluxo.
Sem deploy, OpenAI, Agent, Skills, U01, agenda, clientes, estoque, financeiro,
WhatsApp ou alteração dos sete agentes internos. O MVP não importa o pacote HQ.

## Domínio preservado

`service-catalog.ts` extrai o cadastro real de `servicos/actions.ts`, incluindo
preço FIXED/FROM, `priceSnapshot`, nota, variantes, processamento/finalização,
validação de recurso físico ativo no tenant e imagens. As Actions tradicionais
continuam chamando esse domínio, com retorno do registro salvo.

O update passa a ser patch: chave ausente/undefined preserva; null limpa somente
campo anulável; zero é valor explícito. Mescla e valida sob lock da linha.
A soma processamento + finalização continua menor que duração total. FROM
preserva sua nota quando omitida; mudar explicitamente para FIXED conserva a
normalização existente (nota nula). Variante mantém a composição do nome.
Atualizar ID inexistente/de outro salão retorna SERVICE_NOT_FOUND, sem sucesso falso.

Nenhuma regra de checkout, snapshot de reserva ou agenda foi modificada.
Os campos avançados permanecem no domínio e no formulário atual, mas não estão
expostos no contrato estreito de criação da massagem.

## Contratos

Todos os contratos de entrada rejeitam propriedades desconhecidas. As Server
Actions obtêm usuário/salão exclusivamente de getTenantContext, nunca do input.
O domínio relê Membership e Salon dentro de withTenant, com locks compartilhados:
somente OWNER/MANAGER, salão APPROVED. O MVP exige moeda BRL.

| Equivalente | Action | Entrada | Resultado |
|---|---|---|---|
| U02 | getServiceCreateRequirements | nenhuma; operação única | requisitos versionados; name/durationMin/priceCents; profissional não obrigatório |
| U03 | saveServiceCreateDraft | `{patch, draft_ref?, expected_revision?}` | referência, revisão, fields, NEEDS_INPUT/READY, missing_fields, pergunta e validade |
| Texto determinístico | submitServiceCreateMessage | `{message, draft_ref?, expected_revision?}` | mesmo resultado de U03 |
| T17 | prepareServiceCreateProposal | `{draft_ref, draft_revision}` | proposta persistida, referência, fields, preview, hash, validade e versão de requisitos |
| Confirmador | confirmServiceCreateProposal | `{proposal_ref, draft_revision}` | `{service:{id,name,durationMin,priceCents},duplicate,...referências}` |

Entradas parciais válidas são persistidas. Duração inválida é rejeitada sem
alterar o rascunho. Nenhuma duração, categoria ou pessoa é inferida.

Parser local propositalmente limitado a `Cadastre uma massagem por R$50` e
respostas como `60 minutos`; aceita também preço com centavos. Não é NLP geral.
Clientes técnicos também podem enviar `{name:"Massagem",priceCents:5000}` como
patch, sem passar pelo parser. Nenhuma chamada de inferência é feita.

## Fluxo demonstrado

1. `{name:"Massagem",priceCents:5000}` → revisão 1, NEEDS_INPUT,
   `missing_fields=["durationMin"]`, pergunta sobre duração.
2. `60 minutos`, mesma referência e expected_revision=1 → revisão 2, READY.
   Nome e preço continuam no mesmo rascunho.
3. Preparar proposta da revisão 2 → preview Massagem / R$ 50,00 / 60 minutos,
   com indicação dos defaults reais de persistência, sem categoria/profissional.
   A contagem de Service ainda é zero.
4. Confirmar referência/revisão → grava Service e recibo na mesma transação.
5. Repetir, inclusive concorrentemente → mesmo service.id; duplicate=true;
   nenhuma segunda inserção para essa proposta.

## Persistência e segurança

Reutiliza AuditLog append-only, isolado por salonId + userId + entityType
SERVICE_CREATE_MVP. Ações específicas guardam versões de draft, proposta e recibo.
Nenhuma migration/modelo/policy do produto foi alterada. O adaptador é deliberado
para este MVP, não uma infraestrutura genérica de agentes ou drafts.

Advisory lock transacional por salão/draft serializa patch/proposta/confirmação.
Revisões de 1–100, prazo do draft de 30 minutos e proposta de até 10 minutos.
Mudança do draft invalida propostas antigas; confirmação não aceita fields novos.
Hash SHA-256 vincula os três campos, moeda e requirements_version. O conteúdo vem
do servidor. Versão de requisitos incompatível falha fechada. Uma transação
abortada não deixa serviço sem recibo. Recibo de execução já concluída pode ser
reconsultado por retry, mas autorização continua sendo revalidada.

As Actions do MVP ficam desligadas por padrão. Exigem
SERVICE_CREATE_MVP_ENABLED=true e APP_ENV=development/test, e recusam
VERCEL_ENV=production. A refatoração do domínio tradicional não depende da flag.
O guard existente database-safety também recusa URL remota nas Actions do MVP,
mesmo se APP_ENV estiver incorretamente rotulado como development/test.
Não há tela nova, rota de chat nem ativação de produção: esta entrega é backend
com demonstração automatizada e Server Actions preparadas.

## Ambiente e reprodução dos testes

Foi criado cluster PostgreSQL 16 nativo exclusivo em diretório temporário
`everflair-service-mvp-<uuid>/data`, loopback 127.0.0.1:55441. Não foi usado
Docker/container. O servidor PostgreSQL já existente e suas bases não foram usados.
Consulta somente leitura confirmou caminho/host/porta e ausência de tabelas de
aplicação antes da criação do banco sintético `everflair_service_mvp`.

Para reproduzir em Windows com PostgreSQL 16, criar OUTRO cluster vazio com
initdb/pg_ctl em diretório temporário novo com esse prefixo, na porta 55441 livre,
usuário de bootstrap local `mvp_test_admin`, escutando somente 127.0.0.1.
Não reutilizar conexão obtida da Vercel/Supabase nem apontar para bases existentes.
Inicializar somente o schema atual com `npm run db:push -- --skip-generate`,
usando APP_ENV=test e DATABASE_URL/DIRECT_URL locais explícitas; executar
`npm run db:generate`. Não executar seed.

Antes do bootstrap RLS ou das fixtures, `assertMvpTestDatabase` verifica URLs,
nome do banco, porta, endereço real e data_directory exato. O bootstrap exige
zero usuários/salões/clientes. Falha fecha a execução antes das gravações de teste.

```powershell
$env:APP_ENV='test'
$env:VERCEL_ENV='development'
$env:MVP_TEST_ADMIN_URL='postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp?schema=public'
$env:DIRECT_URL=$env:MVP_TEST_ADMIN_URL
$env:DATABASE_URL='postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp?schema=public'
$env:MVP_TEST_CLUSTER='<diretório temporário exato>/everflair-service-mvp-<uuid>/data'
$env:MVP_PSQL_PATH='C:\Program Files\PostgreSQL\16\bin\psql.exe'
npx tsx scripts/setup-service-mvp-test.ts
# Somente se o bootstrap anterior terminar com código 0:
$env:RUN_SERVICE_MVP_INTEGRATION='1'
npx vitest run src/lib/__tests__/service-contract.test.ts src/lib/__tests__/service-mvp-actions.test.ts src/lib/__tests__/service-create-mvp.integration.test.ts
```

O bootstrap é exclusivo de banco vazio: usa as policies RLS existentes e cria
role local mvp_service_runtime sem superusuário/BYPASSRLS. Não migra produção.
Service, AuditLog, Salon e Membership têm ENABLE/FORCE RLS conferidos pelo teste.
AuditLog só tem SELECT/INSERT para o runtime. Os testes não usam essa role para
DDL. O bootstrap/fixtures usam conexão administrativa somente no cluster vazio
identificado; as operações reais são executadas pelo runtime através de withTenant.

## Cobertura e evidências

31 testes focados passaram: 11 contratos puros, 5 fronteira de Actions e 15
integrações PostgreSQL. Cobrem todos os dez itens pedidos, concorrência,
rollback, expiração, suspensão, autor diferente, cross-tenant, payload extra,
preservação de campos avançados e recurso físico inválido.

Verificação geral: lint e TypeScript aprovados; build Next.js 15.5.25 aprovado,
com 60 páginas estáticas geradas. `npm test -- --maxWorkers=2`: 217 arquivos,
1.178 testes aprovados. Uma rodada anterior com concorrência padrão teve timeout
de 5 segundos no teste preexistente no-fixed-password; ele e toda a suíte passaram
na repetição com dois workers, sem alterar teste ou timeout. Os 31 testes focados
incluem unitários já contabilizados na suíte geral; os totais não devem ser somados.

Exemplo real da primeira execução: Service `cmuaiwo6x000ca0tk94gzr2nn`,
Massagem, priceCents=5000, durationMin=60, priceType=FIXED, categoria nula;
uma linha no salão sintético correspondente após confirmação repetida.
Outros cenários têm salões próprios, sem compartilhar dados de clientes.
Contagens globais após os testes: ClientProfile=0, Appointment=0, Product=0,
Payment=0. Nenhum dado produtivo foi copiado ou acessado.
O cluster exclusivo foi encerrado com pg_ctl ao concluir a validação; os arquivos
temporários sintéticos foram preservados. O servidor PostgreSQL preexistente não
foi parado ou alterado.

O teste de Server Action simula somente a sessão/framework; o teste de domínio
usa banco e RLS reais. Não foi feita jornada de login/browser ponta a ponta.
Sem alteração de schema do produto: migration/schema-smoke de nova migration
não se aplica. A criação do schema e políticas ocorreu apenas no banco descartável.

## Limitações e rollback

- Idempotência cobre a mesma proposta/draft. Dois drafts independentes confirmados
  explicitamente podem cadastrar nomes iguais, como o catálogo atual permite.
- Não há busca semântica de duplicados, interface de chat, autenticação de navegador
  exercitada, retomada visual, limpeza automática ou índice novo para o journal.
- O journal atende ao volume do MVP; não representa escolha definitiva para F3–F8.
- Não habilitar em produção nem criar integração IA sem nova aprovação.
- Rollback: manter a flag desligada e reverter somente os arquivos desta entrega.
  Não apagar Service/AuditLog; a aplicação anterior ignora os novos tipos de evento.
  Nenhuma migration reversa é necessária. Encerrar apenas o cluster temporário
  identificado com pg_ctl stop; não encerrar o serviço PostgreSQL existente.
- Sem push/PR nesta entrega para não acionar Preview/deploy vedados pelo pedido.
  O checkout original e suas alterações preexistentes permanecem intactos.
