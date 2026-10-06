# Secretária — runbook de pré-piloto e piloto futuro

Estado em 25/09/2026: **PREPARADO, NÃO EXECUTADO**. Não habilita clientes reais.
Responsável pelo produto: Alison. Operador técnico e dispositivo físico devem ser
identificados no registro da sessão antes de habilitar qualquer ambiente.

## Entrada obrigatória

1. Auditar o destino autenticado e registrar host/porta/database, identificador do
   cluster, runtime, versão PostgreSQL, RLS/FORCE/policies e migrations rastreadas
   e manuais. Não aplicar diretórios de migrations indiscriminadamente.
2. Demonstrar isolamento de DB, Redis/KV, storage, credenciais, URLs e integrações.
   O Preview atual de `salon-saas` possui cinco variáveis Upstash partilhadas com
   Production; **não usá-lo para este smoke**. Não remover conexões de Production.
3. Registrar baseline/dump, hashes por tabela, privilégios completos e restauração
   exata. Preparar dois tenants sintéticos e atores de papéis diferentes. Nenhuma
   credencial ou dado pessoal real deve entrar nos artefatos.
4. Congelar o candidato com commit, árvore, lockfile, build e deployment. O HEAD
   local `9b92138` não representa sozinho o candidato: há mudanças dos Gates
   anteriores ainda não commitadas. Registrar diff/hash antes de publicar.
5. Manter integrações externas, billing, Meta, e-mail/push e cron de entrega
   desligados. Para as consultas financeiras, usar lançamentos sintéticos,
   sem chamar gateways. Não reutilizar env ou secrets do HQ/produção.
6. Validar a topologia: a conversa atual depende de um único processo, expira em
   20 minutos e não é retomada em outro worker. O guard atual ainda bloqueia
   staging. Somente após auditar o destino preparar sua configuração explícita;
   não remover o guard nem fingir que há persistência distribuída.

## Habilitação e desligamento

Controle adicional implementado: `SALON_SECRETARY_ALLOWED_ACTORS`, JSON de pares
exatos obtidos da autenticação, por exemplo (apenas formato, não IDs habilitados):

```json
[{"salonId":"synthetic-tenant-id","userId":"synthetic-owner-id"}]
```

`[]` bloqueia todos. Staging exige essa configuração; listas ausentes, inválidas
ou com wildcard são recusadas. A admissão é adicional à autenticação, papel,
RLS, regras de domínio e guard do ambiente. Não concede qualquer permissão de
negócio. Layout, rota e Server Actions verificam a admissão. As chamadas em
sessões abertas também são verificadas de novo.

Depois do preflight, habilitar apenas o par sintético e os flags necessários ao
caso. Verificar OFF → indisponível, ON → disponível só para esse par, outro
tenant/usuário → indisponível, papel não autorizado → negado. O guard de ambiente
permanece bloqueado neste commit de preparação, portanto não há habilitação remota.

Para interromper: `SALON_SECRETARY_ENABLED=false`,
`SALON_SECRETARY_ALLOW_PAID_CALLS=false`, `SALON_SECRETARY_ALLOWED_ACTORS=[]`,
FRONT/VOICE/JEV/MULTI_ACTION/OVERLAP OFF. Alteração de env exige aplicação no
processo/deployment: medir tempo de efetivação e testar uma conversa já aberta.
Não afirmar desligamento instantâneo sem esse teste. Não interromper COMMIT em
andamento nem repetir mutation de resultado incerto; reconciliar pelo journal,
receipt e estado autoritativo primeiro. Preservar auditoria.

## Smoke mínimo e evidência

| Caso | Verificação exigida |
|---|---|
| A: leitura | Resultado corresponde à fixture; nenhuma mutation operacional |
| B: missing field | Pergunta natural, mesmo plano após resposta |
| C: mutation confirmada | Proposal → botão → receipt real → estado/refresh correto |
| D: multi-action | Ações, dependências e grupos correspondem ao contrato; resultados individuais |
| E: conflito | Backend revalida o estado e fornece somente alternativas reais |
| F: HARD_BLOCK | Sem override indevido e zero mutation |
| G: stale | Corrigir R$80 para R$90; confirmação velha recusada, somente nova executa |
| H: replay | Mesma aprovação; uma alteração, receipt/idempotência comprovados |

Reaproveitar C/D/G/H para Agenda, Produtos e Serviços, evitando mutations
repetidas. Persistir pre/post-state, proposal/hash/revisão, aprovação, request,
resultado transacional, receipt, audit e contagem de efeitos por action. Testar
tenant B e papel negado; requisição sem tenant não lê dados. Separar AuditLog
técnico dos dados operacionais. Partial failure deve aparecer por item; não
fabricar falha no staging por mock do backend para alegar prova real.

## Dispositivo físico

Registrar modelo, SO, navegador/versão, permissão, rede e condição acústica.
Executar fala real: “Quanto faturei ontem?”, “Marca o Fábio amanhã”, responder à
clarificação, editar transcrição e preparar mutation com confirmação visual;
provocar conflito da fixture. Testar silêncio, recusa/revogação de microfone,
cancelar, refazer, retry e texto. Uma condição de ruído moderado, sem prometer
robustez acústica além do observado. TTS, quando disponível, não confirma ações.

Anotar frase dita/transcript sem PII, resultado e latência por amostra. Mock de API,
viewport mobile e WAV sintético não resolvem `STT_REAL_DEVICE`. Somente evidência
física pode alterar esse status. Nenhum dispositivo foi identificado nesta rodada.

## Observação e alertas mínimos

Durante o smoke, operador acompanha logs do deployment isolado e auditoria
tenant-scoped. Relacionar request/correlation, tenant, session/run, plan/action,
confirmation e receipt. Já existe telemetria técnica de tokens/model/request/
response/status no AuditLog; comprovar a cadeia no deployment antes do piloto.
Não gravar chave, áudio bruto, prompt completo ou corpo cru de erro do provedor.

Parada imediata em **qualquer** cross-tenant, mutation sem confirmação/stale,
duplicação, HARD_BLOCK ignorado, entidade errada, receipt inconsistente ou efeito
externo. Congelar evidências e desligar admissão/paid calls. Para provider errors,
latência e custo, definir limites numéricos com o responsável antes da janela;
não considerar tokens limitados por chamada como teto financeiro por conversa.
O transporte já usa retries=0, timeout HTTP=30s, turno=45s, maxTurns=1 por Runner,
store=false, sem hosted tools/containers. Sessões têm até 20 turnos; uma mensagem
composta pode envolver mais de uma chamada. Teto monetário e alerta agregado de
conversa ainda precisam de prova/configuração em staging, não são PASS atuais.

Medir STT, Luna, backend/DB, E2E e refresh separadamente; campos indisponíveis
ficam N/A. Informar n, min/média/max e mediana quando útil; não usar p95 de uma
bateria minúscula. Registrar versão/data das tarifas para custo estimado.

## Rollback ensaiado antes do piloto

Preservar build anterior, configuração isolada e baseline. Desabilitar admissão;
reconciliar operações em curso; repor apenas build/config do staging e verificar
URL/versão/flags/isolamento. Não desfazer negócios commitados via rollback de app.
Restaurar DB somente mediante procedimento específico, em fixture descartável e
após preservar estado pós-falha. Jamais restaurar dados de produção.

No Codespace, preservar demonstração/porta 3000 e checkout Billing anteriores;
usar checkout/porta próprios, um processo e DB sintético identificado. Não
assumir que a instância histórica ainda existe sem auditoria autenticada.
No Preview Vercel, reverter apenas o candidato/alias de staging isolado. Não
usar `vercel rollback`/`promote` no projeto produtivo: o comando de rollback
documentado atua em deployments de produção. [Documentação Vercel](https://vercel.com/docs/cli/rollback).
Mudanças de env atingem deployments posteriores; validar efetivação com novo
build/processo. [Variáveis Vercel](https://vercel.com/docs/environment-variables).

## Saída

Preservar artefatos com hashes e horário; marcar cada caso PASS/FAIL/NOT_EXECUTED.
Rodar regressões e flags OFF. Readiness exige STT físico e staging completos.
Feedback futuro deve registrar cenário, esperado/observado, versão e correlação
sem PII; reproduzir primeiro em fixture. Cliente real e produção exigem nova
autorização específica após readiness. Este runbook não inicia piloto.
