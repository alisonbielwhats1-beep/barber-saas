# Sessão manual da Secretária — 26/09/2026

## 26/09/2026, 13:24 BRT — staging corrigido ON para teste manual

Após autorização explícita, candidato `Rc178sgIPRIkRYhtUSoDt` instalado e
iniciado somente para Fixture A / Tatiana A. Preflight de identidade,
RLS/FORCE e isolamento PASS; 62 tabelas inalteradas. Sete páginas autenticadas
HTTP 200. Nenhuma mensagem, confirmation ou chamada paga realizada no preparo.
Limite original preservado: 8/20 tentativas consumidas, 12 restantes.
Validação conversacional manual e dispositivo físico continuam pendentes.
Production não acessada. Os registros OFF/local-only abaixo são históricos.
[Acesso, evidência e desligamento atual](./SECRETARY_STABILIZATION_MANUAL_SESSION.md).

Atualização 11:21 BRT: corrigido observador que consumia o corpo antes do Next.
Dois `start` HTTP 500 preservados; revalidação apenas da abertura = HTTP 200,
173 ms, zero chamada paga. Mesmo build e escopo de admissão; sessão novamente ON.
[Diagnóstico BEFORE/AFTER](./SECRETARY_MANUAL_OBSERVER_FIX.md).

Sessão `manual-20260926-01`, aberta às 13:53:57Z / 10:53:57 BRT a pedido do
responsável. Build existente `X_pW4ibxpeH-NHIM1dIDS`, sem alterações no produto.
Preflight DB identity, RLS/FORCE, app_runtime e isolamento A/B/no-context PASS.
Baseline das 62 tabelas idêntico ao fechamento temporal anterior.

URL privada: https://glorious-enigma-jjv6v4rvrv49f544r-3001.app.github.dev/servicos/secretaria

Somente tenant `688f55c7-4b79-4331-9909-bf9985d271f8` / user
`cmuh46ndw0001j7z7bjohmbbq`. UI: **Secretária • Fixture A / Tatiana A**.
Navegador do Codex já autenticado; painel aberto, vazio. Nenhuma mensagem enviada
pelo agente. Em outro navegador, autenticar diretamente no GitHub e na conta
sintética, sem enviar credenciais ao chat. A credencial existente foi colocada
somente no arquivo privado remoto (0600):
`/workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z/manual-login-private.txt`.
Pode ser aberto pelo usuário via Ctrl+P no Codespace; não publicar/copiar ao chat.

ENABLED/FRONT/VOICE/PAID/MULTI_ACTION_V2/OVERLAP ON; JEV OFF. Integrações externas
permanecem bloqueadas pelo contrato validado. Limite de 20 tentativas de provider
nesta sessão, sem retries automáticos. Preparo: zero chamadas pagas. Journals
anteriores intactos. O limite é de requisições, não declaração de fatura real.

Health autenticado HTTP 200: Hoje, Agenda, Clientes, Serviços, Produtos,
Financeiro e Secretária. UI real acessível pelo endpoint privado. Sessão ainda
não validada: o usuário fará a bateria. Não houve novo teste físico/STT.

Observabilidade remota no diretório acima: `manual-20260926-01-requests.jsonl`
registra inputs/outputs apenas das Server Actions start/send/confirm, com
correlation ID, status e latência; exclui login/cookies/headers. Journals
`manual-20260926-01-api-budget.jsonl` e `manual-20260926-01-model-output.jsonl`
preservam uso/custos estimados e interpretação. AuditLogs mantêm drafts/plans,
confirmações/receipts. Refresh visual dependerá da observação manual do usuário;
logs de backend não substituem esse critério.

Para encerrar, dizer **terminei** ou **desligue o staging**. O agente deve
executar OFF, reconciliar baseline/confirmations e consolidar. Alternativa
direta no terminal do Codespace:

```sh
node /workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z/manual-20260926-01-control.cjs stop
```

Fechar o painel não desliga o runtime. Ao parar, conferir flags false, admissão
vazia, paid OFF, porta livre, RLS/isolamento, Outbox e mudanças correspondentes
somente às confirmações autorizadas. Não reiniciar enquanto o usuário testa.

E/E2 continuam limitação conhecida; D histórico permanece UNKNOWN. Voz física
será preparada após aprovação digitada. Production não acessada. O usuário
exige parada antes de qualquer deploy produtivo futuro.

[Preflight e saúde sanitizados](./SECRETARY_MANUAL_STAGING_SESSION.json).
