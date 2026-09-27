# STAGING + REAL DEVICE + PILOT READINESS

Estado em 25/09/2026: **AUDITADO/PREPARAÇÃO LOCAL — NOT_VALIDATED**. O responsável
autorizou explicitamente execução isolada de staging e dispositivo físico nesta
nova fase; produção/piloto real continuam proibidos. O plano abaixo foi preservado
como referência. Auditoria encontrou Preview com Redis compartilhado e acesso ao
Codespace pendente: [resultado](./SECRETARY_STAGING_READINESS_AUDIT.md).

1. **Staging semelhante à produção:** identificar ambiente isolado e dados sintéticos, runtime sem SUPERUSER/BYPASSRLS, grants mínimos, RLS/FORCE, backup e rollback. Auditar a passagem do guard atualmente restrito ao laboratório local; não simplesmente remover a proteção ou reutilizar credenciais produtivas.
2. **Dispositivo real:** validar fala pt-BR em desktop e telefone efetivos, permissões permitidas/negadas/revogadas, ruído, silêncio, interrupção, retry, edição e envio manual. Registrar browser/SO/dispositivo, transcript e latência observada; não usar API simulada como prova. STT_REAL_DEVICE deve sair de REQUIRES_REAL_DEVICE_VALIDATION antes do piloto de voz.
3. **TTS e acessibilidade física:** voz local disponível/indisponível, saída de áudio, confirmação visual, leitor de tela, teclado físico/virtual, safe areas e foco em aparelhos reais.
4. **Smoke E2E de staging:** texto/voz → proposal → confirmação → backend → receipt → atualização de Agenda/Produtos/Serviços; stale UI, falha parcial, HARD_BLOCK, replay e isolamento. Comparar registros esperados e efeitos externos bloqueados.
5. **Observabilidade:** medir transcrição, preparação, confirmação, execução, receipt e refetch separadamente. Correlacionar sem gravar áudio, secrets ou conteúdo sensível desnecessário. Distinguir silêncio/permissão/provider de falha operacional e pós-commit.
6. **Feature flags:** OFF por padrão, habilitação controlada para tenants sintéticos/autorizados, desligamento verificável e preservação dos receipts. Voz e integrações externas devem manter controles independentes.
7. **Preparação de piloto:** definir responsáveis, participantes autorizados, suporte, critérios de entrada/saída, sinais de interrupção, janela de observação e plano de rollback. Exigir dispositivos reais PASS, staging smoke PASS e zero bypass/mutation inesperada antes de iniciar.

Fora desta fase: Meta/WhatsApp, wake word, app fechado/hands-free, Agent Core
genérico, expansão JEV e novo cérebro. Deploy isolado de staging está autorizado,
mas depende do preflight. Produção/cliente real/piloto continuam exigindo etapa
futura explícita. Nenhuma infraestrutura, automação ou flag foi ativada nesta
preparação. [Runbook](./SECRETARY_PILOT_RUNBOOK.md).
