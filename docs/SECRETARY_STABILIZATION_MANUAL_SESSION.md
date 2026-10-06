> Atualização 26/09/2026 14:02 BRT: build e orçamento deste documento são históricos.
> Estado atual: [correção de roteamento](./SECRETARY_CONVERSATION_ROUTING_FIX.md) e STATUS_ATUAL.

# Staging estabilizado — sessão manual disponível

26/09/2026, 13:24 BRT. Autorização: “prossiga”, após informar que as correções
estavam locais. Estado comprovado neste checkpoint: ON para um único ator
sintético. Aguardar uso manual; não executar bateria pelo usuário.

## Acesso

[Secretária no staging](https://glorious-enigma-jjv6v4rvrv49f544r-3001.app.github.dev/servicos/secretaria).
Conta visual: Fixture A / Tatiana A; navegador do Codex autenticado, painel vazio.
Em aba antiga, recarregar e iniciar nova conversa. Credenciais não são publicadas.
Tenant `688f55c7-4b79-4331-9909-bf9985d271f8`, user `cmuh46ndw0001j7z7bjohmbbq`.

## Candidato e evidência

Build `Rc178sgIPRIkRYhtUSoDt`; base Git `9b92138ec7665342b60e1ddc210f04ccfa611c84`
mais alterações locais preservadas (não é commit publicado).
671 fontes/config/schema de runtime comparadas, 15 diferenças esperadas de produto;
17 arquivos transferidos incluindo dois scripts de observação/budget.
Manifest SHA256 `7285a916593ce7be38b379a72d236e49fb4be2b4108e41488cde698626828854`.
Artefato SHA256 `8d7a27e08eda45dacef65b3a2f6a5c2a7539fb87e9c353c961a42b4ec75597d7`.

Uma tentativa de build no Codespace recebeu SIGTERM externo, sem diagnóstico
conclusivo da origem. Evidência de falha preservada separadamente. Build equivalente
em Docker local isolado, Node 22.16.0/Linux x64: npm ci e npm run build PASS,
sem credenciais ou acesso a banco. Artefato verificado antes de instalar no staging.
Não se declara correção da causa do SIGTERM.

Regressão local anterior, uma execução: 2.715 testes / 294 arquivos PASS;
lint, TypeScript e build PASS. Integração PostgreSQL não incluída nessa suíte.
Nova validação de linguagem natural com Luna ainda depende da sessão manual.
[Relatório sanitizado ao vivo](./SECRETARY_STABILIZATION_MANUAL_SESSION.json).

## Preflight e health

DB `everflair_billing_staging`, system `7682424799483236389`, role app_runtime
sem superuser/BYPASSRLS. RLS/FORCE inalterados e isolamento A/B/no-context PASS.
62 tabelas inalteradas; Outbox preservada, incluindo suas duas linhas preexistentes.
Runtime PID 13157, iniciado 16:23:44Z, modo MANUAL_STABILIZATION.
HTTP 200 autenticado: /hoje, /agenda, /clientes, /servicos, /produtos,
/financeiro e /servicos/secretaria. Nenhuma mensagem ou confirmation enviada
pelo agente; zero chamadas pagas no preparo.

Flags ENABLED/FRONT/VOICE/PAID/MULTI_ACTION_V2/OVERLAP ON conforme sessão autorizada;
JEV OFF. Allowlist de exatamente um tenant/user acima. Integrações externas
bloqueadas pelo contrato existente; Meta/WhatsApp não habilitados.
Journal e limite original preservados: 8 tentativas usadas de 20; 12 restantes.
Tentativas não são fatura nem custo monetário. Observadores passivos conservam
logs de request/provider; budget mantém sua reserva anterior à rede.

## Uso e limites

Permitir perguntas livres, leitura, clarificação, correções e mutations reversíveis
nas fixtures exclusivamente após proposal visual e confirmação explícita do usuário.
Não garantir remarcação de horário já passado: consultar agenda atual sem alterar
relógio ou fixtures. E/E2 mantém limitação de comunicação, D histórico UNKNOWN.
Voz física não validada; não declarar pilot readiness. Sessões ainda estão em
memória do processo; durabilidade produtiva continua pendente. Production não acessada.

## Desligamento

Quando o usuário terminar ou pedir desligamento, executar no Codespace:

```bash
node /workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z/stabilization-control.cjs stop
```

Usar este controlador do candidato atual, não o histórico preso ao build anterior.
Ele desliga runtime, flags/admission e paid calls, preservando journals e reconciliando
estado/RLS/Outbox. Confirmar relatório OFF e porta livre. Fechar o painel não desliga
runtime. Consolidar testes manuais somente após o usuário informar que terminou.
