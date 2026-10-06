# Secretária — piloto em Produção (salão de apresentação)

Decisão do dono em 05/10/2026: a Secretária vai para Produção **somente para o dono do salão de apresentação**
(`everflair-apresentacao`, dados fictícios), com teto de gasto diário de **US$ 1** e todas as funções certificadas.
Nenhum outro salão vê o botão nem consegue usar a Secretária.

## Como o código garante isso

- `src/lib/secretary-production-pilot.ts`: o piloto só liga com `VERCEL_ENV=production` **e** `SALON_SECRETARY_ENABLED=true`
  **e** `SALON_SECRETARY_PRODUCTION_PILOT=true`. Aí só os pares exatos salão+usuário de `SALON_SECRETARY_ALLOWED_ACTORS`
  (1 a 5) entram; lista ausente, vazia ou malformada recusa todo mundo.
- Teto diário (`SALON_SECRETARY_DAILY_BUDGET_USD`, padrão US$ 1): antes de cada mensagem e de cada gravação, soma o gasto do
  dia do salão (chamadas de modelo registradas pelos tokens, ao preço do cadastro de modelos, mais as reservas de voz). Ao
  atingir, a Secretária responde que o limite de hoje acabou.
- Carteira mensal (decisão do dono em 06/10/2026, `src/lib/secretary-spend.ts`): além do teto diário, um teto mensal por salão
  (`SALON_SECRETARY_MONTHLY_BUDGET_USD`; sem ela vale o antigo teto da voz, `SALON_SECRETARY_TRANSCRIBE_BUDGET_USD`; sem nenhum, US$ 5) soma, no fuso do salão, as duas fontes pagas da Secretária: o modelo
  (DeepSeek, ou a reserva quando ela respondeu, ao preço dela) e a transcrição (GPT Transcribe, pelo custo informado depois da
  gravação; enquanto não acertada, pelo pior caso). A reserva de cada gravação consulta essa mesma carteira (não há mais teto separado da voz). O Jev não faz parte da Secretária. Ao atingir, ela responde que o limite do
  mês acabou. A 1ª mensagem de cada conversa também passa pelos tetos.
- Relatório do HQ (`GET /api/hq/secretary-spend`, só leitura): custo do mês por salão do piloto, custo médio por pedido e a
  margem simulada ao preço por pedido configurado (`SALON_SECRETARY_PRICE_PER_REQUEST_CENTS`, padrão 6; câmbio fixo
  `SALON_SECRETARY_USD_BRL`, padrão 5,60). Serve para fixar o preço pré-pago com meta de 90% de margem; nada é cobrado.
- Fora do piloto, Produção continua fechada como antes (`secretary-rollout.ts`, `salon-secretary-runtime.ts`).
- O modelo principal só responde com certificado Golden válido (`model-certificates.json`); a reserva (Luna) só entra se
  também tiver certificado.

## Ordem dos passos (cada passo em Produção com confirmação do dono)

1. PR desta branch, CI verde, merge no `master` (a Vercel publica sozinha; todas as funções novas ficam desligadas por flag).
2. Supabase Produção (027 pronta para Produção: roteiro em `docs/SECRETARY_027_PRODUCTION.md`; a 026 não entra no piloto): conferir só lendo se as tabelas das migrations manuais 026 (feedback) e 027 (estado da conversa) já
   existem. Se não existirem: preflight, backup e aplicação (`prisma/sql/manual/026_secretary_feedback*`,
   `027_secretary_state*`; não confundir com `026_client_push_reminders` e `027_variable_service_final_prices`, que já vieram do
   `master`), depois `verify`. Conferir também a mudança de schema desta branch sem migration própria: o valor `WHATSAPP` no enum
   `NotificationChannel` e `eventId`/`appointmentId` opcionais em `NotificationOutbox` (usados pela mensagem ao cliente da
   Secretária). Se faltarem em Produção, preparar a migration manual com preflight antes de ligar o piloto.
3. Vercel Produção — **o dono** cadastra os segredos pelo painel (nunca em texto):
   - `SALON_SECRETARY_OPENROUTER_API_KEY` (DeepSeek);
   - conferir `SALON_SECRETARY_OPENAI_API_KEY` e `SALON_SECRETARY_OPENAI_PROJECT` (voz e Luna de reserva).
4. Vercel Produção — variáveis sem segredo (com o ok do dono):

| Variável | Valor |
|---|---|
| `SALON_SECRETARY_ENABLED`, `SALON_SECRETARY_FRONT_ENABLED`, `SALON_SECRETARY_PRODUCTION_PILOT`, `SALON_SECRETARY_ALLOW_PAID_CALLS` | `true` |
| `SALON_SECRETARY_ALLOWED_ACTORS` | `[{"salonId":"<id do salão de apresentação>","userId":"<id do dono>"}]` |
| `SALON_SECRETARY_DAILY_BUDGET_USD` | `1` |
| `SALON_SECRETARY_MONTHLY_BUDGET_USD` | `5` (carteira do mês, modelo + voz; ausente, vale `SALON_SECRETARY_TRANSCRIBE_BUDGET_USD`, hoje 2) |
| `SALON_SECRETARY_MODEL` | `deepseek/deepseek-v4.1-flash` |
| `SALON_SECRETARY_OPENROUTER_PROVIDER` | `together` |
| `SALON_SECRETARY_FALLBACK_MODEL` | `gpt-6-luna` |
| `SALON_SECRETARY_PERSISTED_STATE` | `true` (conversa sobrevive entre instâncias; exige a 027) |
| flags certificadas (as de `scripts/run-secretary-golden-model.cjs`, `CERTIFICATION_FLAGS`) | os mesmos valores |
| `SALON_SECRETARY_FLOW_WINDOW`, `SALON_SECRETARY_VOICE_ENABLED`, `SALON_SECRETARY_VOICE_CORRECTION`, `SALON_SECRETARY_TRANSCRIBE_ENABLED`, `SALON_SECRETARY_TRANSCRIBE_CUSTOMER_NAMES` | `true` |
| `SALON_SECRETARY_TRANSCRIBE_SALONS` | `<id do salão de apresentação>` |
| `SALON_SECRETARY_TRANSCRIBE_BUDGET_USD` | `2` |

   `SALON_SECRETARY_CANCEL_REASON_OPTIONAL` **fica desligada**: entra no contrato do modelo e não foi certificada (ligada no
   piloto em 06/10, o portão recusou o DeepSeek com `SECRETARY_MODEL_NOT_CERTIFIED`; retirada e novo deploy). Qualquer variável de
   `SECRETARY_CONTRACT_ENV` precisa estar igual ao `contractEnv` do certificado. `SALON_SECRETARY_NAME_ALIASES` fica desligada (sem certificação própria). `SALON_SECRETARY_AGENT` e
   `SALON_SECRETARY_PILOT_RESCHEDULE` ficam desligadas.
5. Novo deploy de Produção (as variáveis só valem num deploy novo; `SALON_SECRETARY_FRONT_ENABLED` é fixada na compilação
   desde 05/10, então precisa estar cadastrada antes desse deploy) e `/api/health`.
6. Teste na conta de apresentação: abrir a Secretária, um pedido simples, um por voz; conferir que outro salão não vê o botão.

## Desligar

`SALON_SECRETARY_PRODUCTION_PILOT=false` (ou `SALON_SECRETARY_ENABLED=false`) e novo deploy: a Secretária some na hora.
