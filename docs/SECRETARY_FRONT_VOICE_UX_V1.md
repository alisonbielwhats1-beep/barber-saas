# SECRETARY_FRONT_VOICE_UX_V1 — implementação e validação local

Data: 25/09/2026. Branch `codex/secretary-front-voice-ux-v1`.

**SECRETARY_FRONT_VOICE_UX_V1 = VALIDATED.** Fechamento final: [relatório e evidências](./SECRETARY_FRONT_VOICE_FINAL_CLOSURE.md). Grants snapshot/restore exato, Agenda/Produtos refresh, UI desktop/mobile, voz determinística e regressões PASS. **STT_REAL_DEVICE = REQUIRES_REAL_DEVICE_VALIDATION**, obrigatório antes do piloto. Próxima fase somente planejada; flags OFF e nenhum deploy.

O relatório abaixo é histórico: preserva tentativas anteriores, bloqueios, checks e vereditos daquele momento. O incidente de rollback foi registrado em [resultado anterior](./SECRETARY_FRONT_VOICE_LOCAL_GRANTS_RESULT.md), recuperado e posteriormente encerrado pelo mecanismo validado no relatório final. Não tratar os NOT_VALIDATED históricos abaixo como estado atual.

`TOPIC_14_SECRETARY_BRAIN_V1 = COMPLETE`, `SECRETARY_EXECUTION_E2E_V1 = VALIDATED` e `STALE_CONFIRMATION_FIX = VALIDATED` permanecem preservados. A autorização de implementação é o novo pedido do responsável nesta sessão, que substitui o antigo estado PLANNED_ONLY deste documento.

## 1–3. Arquitetura, reuso e shell

Auditoria anterior ao código: [mapeamento do Front](./SECRETARY_FRONT_VOICE_UX_V1_AUDIT.md). O painel foi integrado ao layout administrativo existente, usando seus tokens, Button, ícones e primitivas Radix. Desktop ≥1280px reserva 400px ao lado do conteúdo; mobile usa tela cheia com visual viewport/safe areas. Abrir/fechar e mudar viewport preservam a conversa montada. O shell fica inert apenas enquanto o painel mobile está aberto. A rota antiga `/servicos/secretaria` abre o mesmo painel.

Não existe um segundo frontend, executor ou domínio. Server Actions obtêm actor/tenant da autenticação; `withTenant` e autoridades existentes continuam validando os acessos.

## 4–5. Voz, STT, transcript e TTS

Adapter de SpeechRecognition/webkitSpeechRecognition em pt-BR. Estados: ouvindo, transcrevendo, transcript pronto/editável; parar, cancelar, refazer e enviar manualmente. Texto digitado e transcrito chegam ao mesmo `sendSecretary`. Eventos atrasados de gravação cancelada são ignorados. Capturar/transcrever nunca envia texto nem confirma ações automaticamente.

`Permissions-Policy` libera microphone=self somente com flag de voz em development/test e fora de Vercel production. TTS curto é solicitado pelo botão Ouvir e usa somente voz local em português; não há reprodução automática.

**STT nativo não comprovado:** Chrome instalado + WAV sintético em português retornou `no-speech`, transcript vazio, zero envio e zero confirmação. API e duas vozes locais pt-BR foram detectadas; detecção não equivale a reconhecimento funcionando. As transições/transcript/edit/cancel/error passaram em testes com API simulada, classificados como testes de adapter, não prova de áudio real. Não foi contratado STT pago.

A disponibilidade de reconhecimento varia por navegador e pode usar processamento remoto do próprio navegador: [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition). Vozes locais são identificadas por [localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

## 6–8. Cards, clarificações e confirmação

Cards exibem operação/entidade, before→after, datas/horários, dependências e status humanos. UUIDs, referências e enums técnicos não são apresentados como conteúdo. `action_keys` foi acrescentado somente à projeção read-only de cada operação, para associar card e receipt sem inferir pela posição.

Perguntas e opções usam dados do backend; não há auto-seleção de candidatos ambíguos. Revisões de 1/5/10/12 ações foram testadas, preservando os grupos e a política 5/10 já existentes, sem novo limite estrutural.

O botão Confirmar transporta exatamente plan_ref/revision/group_key/fingerprint para `confirmActionPlanGroup`. O fallback legado usa seus tokens existentes. Cancelar/alterar não executa. Um bloqueio síncrono evita concorrência local de cliques.

## 9–13. Stale, execução, receipts, parcial e HARD_BLOCK

Qualquer edição desabilita visualmente a confirmação anterior. Na bateria real, R$80 foi corrigido para R$90, sem mutation durante a edição/nova proposal; somente a nova confirmação mudou R$85→R$90.

A interface aguarda o receipt e apresenta resultados por ação. Partial failure não vira sucesso global. Uma resposta de rede perdida preserva a mesma confirmação para verificar novamente; não fabrica outra chave. Falha de revalidação de cache após commit preserva receipt e acrescenta aviso técnico. Expiração de sessão permite iniciar conversa nova, sem prometer recuperar uma sessão volátil.

Remarcação que exige aceite é apresentada como solicitação registrada aguardando cliente. HARD_BLOCK mostra impedimento/alternativas fornecidas pelo backend, confirmação desabilitada e nenhum botão de override. A bateria real deixou o appointment intacto nesse caso.

## 14–16. Sincronização

Server Actions invalidam rotas do produto após receipt; o cliente chama router.refresh. Não há cópia manual de listas/estoque/preço na Secretária. Links contextuais levam a Agenda, Serviços, Produtos ou Clientes.

- **Serviços PASS real:** lista mudou R$100→R$80 após receipt, na mesma tela.
- **Agenda: mutation PASS; atualização da tela BLOCKED:** o Front manual seleciona Payment.id, sem grant na role estreita do Gate anterior.
- **Produtos: mutation PASS; atualização da tela BLOCKED:** o Front manual consulta colunas de Product não concedidas à mesma role.
- Clientes/dashboard também precisam de colunas de ClientProfile, identificadas na auditoria do ambiente.

Nenhum grant foi ampliado. [SQL local mínimo e rollback propostos](./SECRETARY_FRONT_VOICE_LOCAL_GRANTS_PROPOSAL.md) permanecem NÃO APLICADOS, aguardando autorização explícita exigida pelo AGENTS.md. Não se substituiu o runtime por admin nem se alteraram policies/RLS para passar.

## 17–18. Erros e acessibilidade

Erros legíveis para mic negado, captura/STT indisponível, provider/backend, stale, permissão, conflito e rede. Texto/plano são preservados quando seguro. Espera longa mostra feedback sem porcentagem fictícia.

Labels de controles, live regions/status, teclado, foco no resultado e contenção de Tab no mobile. Axe: zero violações nos estados capturados do painel desktop/mobile para WCAG2 A/AA e WCAG2.1 AA. Viewports reais de browser: 1440×900, 390×844 e 320×560. O último representa área reduzida, não certifica teclado físico de Android/iOS. Não houve teste em aparelho físico ou leitor de tela humano.

## 19–20. Testes e evidência operacional

Última bateria: `packages/salon-secretary/evaluation/results/front-voice/2026-09-25T12-37-54-918Z/`. Placar funcional abaixo não oculta o resultado FAIL da asserção final de atualização das telas.

| Caso | Resultado operacional/UI | Banco / evidência |
|---|---|---|
| Texto → service.change | PASS | R$100→R$80; receipt e Serviços atualizam |
| Appointment change | PASS operacional; tela BLOCKED | 10h→11h, duração/cliente/profissional/serviço preservados |
| Inventory | PASS operacional; tela BLOCKED | Shampoo X 10→8 |
| Multi-action independente | PASS | Serviço R$80→R$85; estoque 8→6; dois receipts |
| Stale R$80→R$90 | PASS | Edição sem write; confirmação nova aplica R$85→R$90 |
| HARD_BLOCK | PASS | Fechamento fixture; zero mutation de agendamento; sem override |
| Desktop/mobile/teclado | PASS no escopo observado | Painel persiste; safe area/scroll; 320px sem overflow horizontal |
| Missing field/ambiguidade/1–5–10–12 ações | PASS automatizado | Componentes com contratos reais e respostas controladas |
| Backend failure/partial/timeout/retry | PASS automatizado | Sem sucesso inventado; mesma confirmação no retry |
| Voz simulada/transcript/edit/cancel/denied/STT failure | PASS adapter | Testes de componente |
| Voz nativa com WAV sintético | NÃO VALIDADA | no-speech; zero submit/confirm |
| Refresh Agenda/Produtos | BLOCKED / FUNCTIONAL_FAILURE_SAFE | SQLSTATE 42501; nenhum bypass |

Playwright: 1 probe concluído e 1 teste operacional FAIL por bloqueios das telas; não é 100% PASS. Os seis fluxos operacionais chegaram aos checkpoints finais. Os 15 snapshots verificam 63 tabelas com allowlist exata de linhas/campos; AuditLog é contabilizado separadamente.

Fixture final: tenant `9762607f-edfa-4005-ba35-fe1b2d89e3ca`; 6 alterações de registros de negócio (3 de serviço, 1 appointment, 2 estoque), 1 AppointmentEvent, 1 Outbox INTERNAL e 66 AuditLogs. Um SalonClosure foi inserido explicitamente como preparação do HARD_BLOCK. Sem envio WhatsApp/Meta/pagamento. Runtime NOSUPERUSER/NOBYPASSRLS, 19 tabelas RLS/FORCE e isolamento sem contexto/tenant verificados. Todas as baselines anteriores foram preservadas na criação de fixtures novas.

Dumps antes/depois válidos por pg_restore -l:

- Antes: SHA256 `dada4c606d26d3b01223a35891767ef06e75b2fdb2305f0ea5d7640dcffeec88`.
- Depois: SHA256 `9950515f26f3c31227c22aa7f367388abdb8171afe8ce683b6186357ee015420`.

Evidência consolidada: `packages/salon-secretary/evaluation/results/front-voice/consolidated-front-evidence.json`. Capturas: desktop-proposal, desktop-service-receipt, desktop-agenda-receipt, desktop-inventory-receipt, desktop-multi-receipts, desktop-hard-block, mobile-shell, mobile-hard-block, mobile-small-keyboard e native-voice-mobile, no diretório da bateria.

## 21. Regressões

- `npm test -- --maxWorkers=2`: **2.541 PASS / 282 arquivos** após a bateria (141,10s).
- `npm run lint`: PASS, zero warnings/erros.
- `npx tsc --noEmit --incremental false`: PASS.
- `npm run build`: PASS, exit 0; flags OFF, URL de DB inacessível por desenho e fonte local mockada, sem deploy.
- Playwright controlado: **1 probe concluído, 1 FAIL seguro** na asserção de refresh de Agenda/Produtos. Não converter esse resultado em PASS.
- Logs finais: `front-voice-final-suite.log`, `front-voice-final-lint.log`, `front-voice-final-typescript.log`, `front-voice-final-build.log` em `packages/salon-secretary/evaluation/results/`.

## 22. Bugs e ajustes comprovados

- Modal mobile force-mounted retinha bloqueio invisível após fechar: corrigido; reabertura e preservação de texto passaram no navegador.
- Microfone era proibido pelo cabeçalho do app: habilitação restrita à flag local/test, produção continua bloqueada.
- Receipt de remarcação pendente precisa dizer que aguarda aceite; apresentação agora usa outcome do receipt.
- Cache pós-commit pode falhar: receipt permanece SUCCESS com aviso, coberto por regressão.
- Harness: diretório de Next, senha fixture já configurada, valores de env em branco, sequência de respostas entre route bundles e número de destinatários da Outbox foram corrigidos com causas/evidências preservadas. Nenhuma regra de domínio ou expected funcional foi relaxado; as telas bloqueadas mantiveram a asserção final FAIL.
- Fontes históricas arquivadas são verificadas contra os hashes originais. Nenhum manifest/expected de Topic14 foi atualizado; live runners continuam rejeitando reutilização de autorizações antigas.

## 23–26. Limitações, flags, rollback e veredito

Zero chamadas pagas/Luna/JEV nesta bateria: interpretação roteirizada, com backend/DB reais. Custo de provider US$0; latência de Luna não medida. As chamadas ao modelo fake têm cursor/request em disco; não usar esses tempos como benchmark de produção. Nenhuma mutation inesperada ou falha de isolamento foi observada. O probe nativo é a única tentativa de serviço de voz do navegador; não comprova STT nem permite declarar ausência de tráfego interno do Chrome a seu provedor.

Flags finais OFF: paid calls, JEV, Multi-Action V2, overlap, Front, Voice, billing e serviços externos. Flags de UI/V2/overlap existiram apenas nos processos locais controlados de teste. `.env.local` preservado, SHA256 `7548c4ec20d910575fe635e03c9e3e067fd8187741752630ac481909b7b1a5d8`. Servidores do harness encerrados. Nenhum deploy, push, PR/Preview ou produção.

Rollback: desligar FRONT/VOICE e manter flags backend OFF. Reverter somente os arquivos/trechos deste Gate usando os backups `front-voice-source-before`; não executar git reset/clean sobre o worktree que já continha mudanças. Nenhuma migration aplicada. Banco, tenants, dumps e evidências permanecem preservados; não restaurar sobre o banco atual. Grants não foram alterados, portanto não há rollback de privilégios a executar.

**SECRETARY_FRONT_VOICE_UX_V1 = NOT_VALIDATED.** Faltam autorização ambiental dos SELECTs mínimos, revalidação do refresh de Agenda/Produtos e um STT nativo que produza transcript verificável. Não iniciar STAGING + PILOT READINESS, Meta ou deploy com base neste resultado.

