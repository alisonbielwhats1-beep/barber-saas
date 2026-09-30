# Secretária — checklist antes de Production

Criado em 29/09/2026, no fim da prova final da candidata `420073b66fb40bba` (programa de confiabilidade da Agenda).
**Estado: NÃO LIBERADO.** O código recusa Production de propósito (`assertSecretaryEnvironment` em
`src/lib/salon-secretary-runtime.ts` exige `APP_ENV` development/test/staging e rejeita `VERCEL_ENV=production`).
Nada abaixo foi executado contra Supabase ou Vercel de Production. Cada item precisa de autorização explícita do dono.

## 1. Candidata e flags

- Código congelado: manifesto `.demo/agenda-core/candidates/420073b66fb40bba.json` (1.521 arquivos com sha256;
  `node scripts/secretary-freeze-candidate.cjs --check 420073b66fb40bba` precisa dizer `CANDIDATE_MATCHES`).
  Ele difere da `66c392c76f89a52f` só em avaliação/testes (`program-spend.ts`, `holdout-usage.ts` e dois testes).
- Flags da candidata (todas as outras `SALON_SECRETARY_*` desligadas):

| Flag | Valor | Observação |
|---|---|---|
| `SALON_SECRETARY_MULTI_ACTION_V2_ENABLED` | `true` | planos com várias ações |
| `SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED` | `true` | conflitos de agenda |
| `SALON_SECRETARY_TEMPORAL_COMPONENTS` | `true` | datas/horas por componentes |
| `SALON_SECRETARY_TEMPORAL_POLARITY` | `true` | "às 11, não às 10"; autocorreção com "pera" |
| `SALON_SECRETARY_SAME_AS` | `true` | "no mesmo dia", "no horário dela", "nesse dia" |
| `SALON_SECRETARY_JIT_INSTRUCTIONS` | `true` | instruções só dos modos publicados |
| `SALON_SECRETARY_STRUCTURED_CONTEXT` | `true` | contexto do plano estruturado |
| `SALON_SECRETARY_NAME_SUGGESTIONS` | `true` | sugestões de nomes parecidos (sempre com clique) |
| `SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD` | `true` | mesmo cliente em dois horários vira pergunta |
| `SALON_SECRETARY_EXAMPLES` | `selected` (K=4) | escolhido no conjunto de validação (+6,7 pontos pareados) |
| `SALON_SECRETARY_PERSISTED_STATE` | `true` | **exige a migration 027 e o purge agendado** |
| `SALON_SECRETARY_JEV_ROUTER_ENABLED` | `false` | |
| `SALON_SECRETARY_NAME_ALIASES` | `false` | pronta, não medida na prova |
| `SALON_SECRETARY_FEEDBACK` | `false` até a 026 | botões "foi útil / não era isso" |
| `SALON_SECRETARY_VOICE_CORRECTION`, `SALON_SECRETARY_TRANSCRIBE_ENABLED` | `false` | transcrição pronta, desligada e sem teste |

- Kill switch: `SALON_SECRETARY_ENABLED=false` desliga tudo. Piloto restrito: `SALON_SECRETARY_ALLOWED_ACTORS`
  (pares salão/usuário), nunca acesso amplo de primeira.

## 2. Banco (Supabase): migrations com preflight

Ordem, sempre com backup e janela combinada:

1. `026_secretary_feedback.preflight.sql` e `027_secretary_state.preflight.sql` são **somente leitura**, mas hoje só aceitam o
   banco local descartável (`everflair_service_mvp@127.0.0.1:55441`) ou o de CI. Para Production é preciso uma versão revisada
   do preflight que identifique o projeto Supabase certo (nome, região, papel) sem relaxar as demais checagens.
2. Aplicar `026_secretary_feedback.sql` e `027_secretary_state.sql`; rodar os `.verify.sql` correspondentes.
3. Grants do papel de runtime do app (o equivalente de produção de `local_app_runtime`; ver `PRODUCTION_APP_GRANTS` em
   `scripts/setup-local-app-role.ts`): `SecretaryConversation` SIUD, `SecretaryConversationEvent` SELECT/INSERT,
   `SecretaryNameAlias` SIUD, `SecretaryFeedback` SELECT/INSERT. RLS FORCE em todas; nenhum papel com BYPASSRLS.
4. **Antes de ligar qualquer flag**: agendar `027_secretary_state.purge.sql` (a cada 30 min) e `026_secretary_feedback.purge.sql`
   (diário) com `.schedule.sql` (pg_cron, papel de manutenção) ou com o agendador da plataforma.
5. Só então ligar `SALON_SECRETARY_PERSISTED_STATE` (e, se quiser, `SALON_SECRETARY_FEEDBACK`).
6. Rollback: desligar as flags, reiniciar, `027_secretary_state.rollback.sql` / `026_secretary_feedback.rollback.sql`.

Evidência local (29/09): preflight, apply e verify da 026 e da 027 no banco descartável; integração da 027 6/6 (inclusive
relógio da aplicação adiantado/atrasado em relação ao banco); replay do Golden com a conversa no Postgres 30/30
(30 conversas e 87 eventos só com códigos).

Por que o estado persistido é obrigatório na Vercel: sem ele a conversa vive só na memória de uma instância; outra
instância (ou um cold start) responde `SESSION_NOT_FOUND` e nada executa (falha fechada, mas o dono perde a conversa).

## 3. Vercel: duração das funções

- A Secretária roda em server actions (`src/app/(admin)/servicos/secretaria/actions.ts`), chamadas da página e do
  dock do layout administrativo. Pior caso de um turno: uma interpretação + um reparo, cada chamada com timeout de 30 s no
  SDK (sem retry) e aborto em 45 s, mais banco. Medido na prova: p50 ≈ 4,7–5,2 s, p90 ≈ 8–10 s por turno; pedidos
  multi-ação longos do dono p50 12 s, p90 22 s.
- Definir `export const maxDuration = 120` no segmento que hospeda as server actions (layout `(admin)` e a página da
  Secretária) e confirmar no painel do plano da Vercel que 120 s é permitido. Validar num Preview antes.
- O lease da conversa é de 120 s (`CONVERSATION_LEASE_SECONDS`): um turno mais longo que isso pode receber
  `CONCURRENT_UPDATE` na gravação; manter `maxDuration` ≤ lease.

## 4. OpenAI: custo e limites

- Custo real medido no ledger (US$ por chamada à Luna, `gpt-6-luna`): ≈ 0,0013 sem exemplos, ≈ 0,0015 com
  `EXAMPLES=selected`; pedidos multi-ação longos ≈ 0,0019. ≈ 9,5 mil tokens de entrada e ≈ 480 de saída por chamada;
  1,2–1,6 chamadas por mensagem do dono.
- Ordem de grandeza: um salão com 40 mensagens/dia ≈ US$ 0,07/dia ≈ US$ 2/mês.
- **Cache de prompt não está pegando** (`cached_input_tokens` = 0 nas baterias): o prefixo estável precisa vir antes do
  que muda por turno. Otimização futura (pode cortar boa parte do custo de entrada); medir antes/depois.
- **Falta cota por salão.** Hoje o uso é registrado (`SALON_SECRETARY_USAGE` em AuditLog), mas nada limita um salão.
  Antes do piloto: limite diário de turnos por salão e usuário, e limite de gasto do projeto no painel da OpenAI.
- Limites de taxa: ≈ 10 mil tokens por chamada; conferir TPM/RPM do tier do projeto contra o pico esperado
  (ex.: 60 mensagens/min ≈ 600 mil TPM).
- Chave e projeto só nas variáveis de ambiente da Vercel (nunca em arquivo ou documento).

## 5. Retenção e privacidade

- Conversa persistida: no máximo 2 h (CHECK de segurança de 3 h), purge a cada 30 min; eventos só com códigos.
- Apelidos aprendidos (flag desligada): apagados sem uso por 365 dias e quando o cliente é mesclado/apagado.
- Feedback (026): só códigos e o turno; purge diário pelo `expiresAt`.
- Telemetria do roteador (AuditLog `SECRETARY_ROUTER`) e uso (`SALON_SECRETARY_USAGE`): só códigos, contagens e tokens;
  nenhuma mensagem, nome ou telefone. Definir a retenção dessas linhas de AuditLog junto com a política geral.
- OpenAI: `store=false` em toda chamada (garantido por `assertSecretaryResponsesPayload`).

## 6. Liberação

1. Commit imutável da candidata; CI verde (typecheck, lint, unitários, integração em Postgres descartável).
2. Preview da Vercel com banco de staging: smoke da Secretária (mensagem, proposta, Confirmar, Descartar).
3. Auditoria somente leitura de Production (versão, flags, banco, alvo de rollback).
4. Mudança de código deliberada e revisada para permitir um piloto restrito em Production (hoje bloqueado de propósito).
5. Deploy com a Secretária desligada; health check; depois ligar para um par salão/usuário do piloto.
6. Monitorar por pelo menos uma semana: taxa de `wire_rejected`, `provider_invalid`, avisos "não entendi", pedidos
   grandes demais (`SECRETARY_REQUEST_TOO_LARGE`), latência p90, custo por salão e feedback.
7. Rollback: `SALON_SECRETARY_ENABLED=false` (imediato) e, se preciso, redeploy do alvo anterior.

## 7. Riscos conhecidos que continuam

Ver a seção de resultados em `docs/SECRETARY_AGENDA_CORE_CHECKPOINT.md` (prova final de 29/09): pedidos multi-ação longos do
dono são a área mais fraca; bloqueios por período ("de manhã", "depois das 4") sempre perguntam o fim; "semana que vem"
sem dia da semana pergunta a data.

## 8. Piloto decidido pelo dono (29/09/2026)

- **Alvo:** a conta demo de Production, "Everflair Studio · Demonstração" (`everflair-apresentacao`), que só tem dados fictícios (ver `docs/DADOS_APRESENTACAO_2026-09-07.md`).
- **Liberação:** a Secretária fica desligada para todos os outros estabelecimentos e liberada por allowlist só para esse tenant e para o usuário dono dele.
- **Antes do deploy:**
  - cota diária por salão/usuário;
  - `maxDuration = 120`;
  - migrations 026/027 com preflight revisado para Production e backup;
  - revisão do impacto da branch nas telas administrativas dos outros salões;
  - build, CI e Preview.
- **Autorizado no freeze:** commit e push da branch e PR em rascunho, sem merge e sem deploy.
- **Exige confirmação explícita, passo a passo:** tudo que toca Production (auditoria somente leitura, migrations, variáveis de ambiente, deploy, ligar a flag).
- **Com o dono:** limite de gasto no painel da OpenAI e chave configurada nas variáveis da Vercel (nunca por chat).
