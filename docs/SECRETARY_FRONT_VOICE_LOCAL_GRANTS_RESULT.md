# Front/Voice — grants locais e parada de segurança

**Registro histórico.** O encerramento posterior está em [SECRETARY_FRONT_VOICE_FINAL_CLOSURE.md](./SECRETARY_FRONT_VOICE_FINAL_CLOSURE.md): Gate VALIDATED, restauração integral comprovada e nenhum grant temporário restante. O incidente e seu veredito original abaixo foram preservados.

25/09/2026. **SECRETARY_FRONT_VOICE_UX_V1 = NOT_VALIDATED.**

O responsável autorizou explicitamente os três escopos de SELECT locais. A tentativa foi interrompida antes dos E2E de refresh. O rollback documentado tinha uma premissa incorreta; os privilégios anteriores foram recuperados e verificados. Nenhum grant novo permanece. Nenhuma mutation de negócio, fixture nova, chamada Luna, mensagem externa ou deploy ocorreu nesta continuação.

## Grants e incidente

Target confirmado por conexão: `127.0.0.1:55441/everflair_service_mvp`, cluster `C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-dumpcheck-20260924-uxbaseline/data`. Runtime `mvp_service_runtime`, SUPERUSER=false/BYPASSRLS=false.

Antes de aplicar, foram preservados pg_dump custom validado por pg_restore -l, schema sem ACL, catálogo de ACLs, roles/memberships/policies/RLS e hashes das 63 tabelas. Foram executados somente:

```sql
GRANT SELECT ON "Product", "ClientProfile" TO mvp_service_runtime;
GRANT SELECT (id) ON "Payment" TO mvp_service_runtime;
```

A comparação byte a byte dos schema dumps acusou diferença nos marcadores aleatórios `\restrict`/`\unrestrict` do próprio pg_dump. A comparação posterior excluindo apenas esses marcadores confirmou schema idêntico. Esse foi um falso positivo do harness, sem alteração de schema.

O bloco finally executou o rollback da proposta. **Esse rollback estava errado:** `REVOKE SELECT ON tabela` removeu também os SELECTs por coluna preexistentes. Houve redução não planejada de privilégios; não houve ampliação de autoridade, mudança de policy ou bypass. A verificação de ACL detectou a diferença e a continuação foi parada conforme a condição do responsável.

A recuperação fez novo backup e restaurou, em uma transação, exatamente os 18 SELECTs anteriores: 7 colunas de Product e 11 de ClientProfile (incluindo xmin). Nenhuma coluna nova foi adicionada à baseline. Comparação de todos os privilégios explícitos da role confirmou igualdade com o snapshot anterior. INSERT/UPDATE e grants de outras tabelas permanecem iguais.

| Objeto | Antes | Aplicação temporária | Final |
|---|---|---|---|
| Product | SELECT em 7 colunas | SELECT tabela | 7 colunas originais |
| ClientProfile | SELECT em 11 colunas | SELECT tabela | 11 colunas originais |
| Payment | SELECTs anteriores, sem id | SELECT(id) | Originais, sem id |

O PostgreSQL materializou a ACL antes implícita do proprietário em Product/ClientProfile (`mvp_test_admin=arwdDxt/mvp_test_admin`). Isso é uma diferença de representação no catálogo, sem diferença de autoridade. Não se alterou pg_catalog manualmente para forçar igualdade binária. Os grants da role runtime foram restaurados exatamente.

## Placar desta continuação

| Item | Resultado |
|---|---|
| RLS/FORCE, policies, roles/memberships | PASS após recuperação; idênticos ao snapshot |
| Runtime sem SUPERUSER/BYPASSRLS | PASS |
| Sem tenant context | SELECT bloqueado por RLS: zero linhas nas três tabelas |
| Tenant e cross-tenant | PASS Product/ClientProfile; duas fixtures anteriores distintas |
| Payment | Sem contexto: zero linhas; fixtures Front não têm pagamentos; não alegar teste positivo de linha estrangeira ausente |
| Baseline das 63 tabelas | PASS; hashes/contagens idênticos, zero mutation operacional |
| Agenda refresh | NOT_EXECUTED nesta retomada; bloqueio anterior permanece |
| Produtos refresh | NOT_EXECUTED nesta retomada; bloqueio anterior permanece |
| Serviços refresh | PASS histórico; regressão nova NOT_EXECUTED |
| Confirmação/receipt | PASS histórico, não repetido |
| Desktop/mobile/a11y | PASS histórico, não repetido |
| STT/no-speech | Diagnóstico adicional NOT_EXECUTED; evidência histórica continua no-speech com WAV sintético |
| STT em dispositivo real | REQUIRES_REAL_DEVICE_VALIDATION; não convertido em PASS |

A causa específica do no-speech permanece indeterminada: não houve medição nova de áudio/permissão/STT nativo. O diagnóstico preparado compara getUserMedia/WebAudio com SpeechRecognition direto e depois o Front, sem enviar/confirmar texto. Não foi executado por causa da parada. O no-speech anterior não prova defeito funcional da Secretária.

## Checks e arquivos

- `npx tsc --noEmit --incremental false`: PASS no preparo desta continuação; log `front-voice-grants-pre-typescript.log`.
- Checks de recuperação PostgreSQL: PASS em `node scripts/restore-secretary-front-local-baseline.cjs`.
- Nova suíte completa/lint/build e novos testes UI/STT: NOT_EXECUTED após a parada. Última bateria histórica: 2.541 testes PASS, lint/TS/build PASS; esses números não são uma execução nova.
- Preparados: `tests/secretary-front/refresh.spec.ts`, `speech-diagnostic.spec.ts`, seleção `--refresh-only` no runner/config e regressão offline de retry após no-speech. Não alegar PASS desses testes novos.
- Nenhum código de produto, cérebro, executor ou regra de negócio foi alterado nesta continuação.
- O entry point `scripts/secretary-front-local-grants.cjs` ficou bloqueado, sem executar SQL, para impedir reutilização automática do harness defeituoso. Seu código executado foi arquivado na evidência.

## Evidência, rollback e estado final

Diretório: `packages/salon-secretary/evaluation/results/front-voice/grants-2026-09-25T13-02-48-049Z/`.

- `before.json`: target, ACLs, privilégios, policies/RLS, hashes/contagens.
- `before-grants.dump`: SHA256 `3885cb3c88f2382f2753a94c37c656615b721756633c0926c1d7d2378557ae70`.
- `rollback.json`: preserva o primeiro rollback incompleto, sem ocultar a ocorrência.
- `before-column-restoration.dump`: backup adicional anterior à recuperação.
- `recovery-verified.json`: comparação exata dos privilégios runtime, segurança, isolamento e hashes finais.
- `rollback-corrected.sql`: rollback corrigido, também preservado em [SQL versionável](./SECRETARY_FRONT_VOICE_LOCAL_GRANTS_ROLLBACK.sql).
- `executed-grants-runner.cjs.disabled`: código exato da tentativa, desabilitado.

Decisão: grants temporários **removidos**, sem permanência como infraestrutura. Banco/dumps/fixtures anteriores preservados; nenhuma restauração global foi feita. Não houve migration. `.env.local` manteve SHA256 `7548c4ec20d910575fe635e03c9e3e067fd8187741752630ac481909b7b1a5d8`; nenhum servidor Front foi iniciado por esta tentativa nem flags ativadas. Estado seguro anterior permanece OFF. Zero produção, Meta, billing, deploy ou chamadas pagas.

Topic14 COMPLETE e Execution E2E VALIDATED permanecem congelados. Parada após recuperação; próxima fase não iniciada.
