# Secretária — preparação técnica de Production (26/09/2026)

**PREPARED; NOT_DEPLOYED.** Inspeção somente do checkout e dos contratos locais.
Nenhuma requisição, credencial, recurso ou dado de Production foi usado nesta etapa.

**STOP vigente:** o caso G de voz preservou "domingo" no transcript, mas produziu
uma proposal executável para sábado, 03/10. Não confirmada; zero mutation; staging
OFF. A falha crítica está em [SECRETARY_AUTOMATED_VOICE_V1.md](./SECRETARY_AUTOMATED_VOICE_V1.md).
Nenhuma promoção é elegível enquanto esse gate estiver reprovado.

## Candidato e promoção

- Checkout: `.worktrees/service-create-mvp`, branch `codex/secretary-final-staging-canary`.
- HEAD: `9b92138ec7665342b60e1ddc210f04ccfa611c84`, com implementação não commitada.
- `CURRENT_PRODUCTION_VERSION = NOT_AUDITED`.
- `CANDIDATE_VERSION = UNCOMMITTED`; HEAD sozinho não identifica o candidato testado.
- `ROLLBACK_VERSION = NOT_AUDITED`. Procedimento/target produtivo ainda não comprovados.
- CI existente executa validações em PostgreSQL descartável, ambiente `test`.
  Resultado local não substitui CI/Preview de um commit imutável.
- As correções de voz desta rodada não alteram schema, RLS ou migrations.
  Isso não certifica o conjunto amplo de alterações preexistentes do checkout.

## Barreiras confirmadas no código

`assertSecretaryEnvironment` e `assertSecretaryRolloutAccess` rejeitam
`VERCEL_ENV=production`. A admissão de staging valida o par exato salon/user;
o gate do Codespace fixa banco local, Redis interno e integrações desligadas.
`secretaryMicrophoneAllowed` também rejeita Production. Portanto, habilitar uma
flag isolada não torna este código pronto para um canário produtivo.

O contrato de comunicação aceita apenas a fixture local homologada e rejeitou
o caso de áudio com "avisa ela" no staging (`COMMUNICATION_LOCAL_ONLY`). Nenhuma
barreira foi relaxada para concluir o teste.

## Sequência preparada, ainda não executada

1. Fechar as lacunas do relatório automatizado; manter teste físico como requisito
   antes de liberar cliente real. Não promover resultado parcial a VALIDATED.
2. Consolidar o candidato exato, revisar o diff completo, obter CI/Preview e
   identificar migrations/admissão necessárias antes de qualquer promoção.
3. Auditar Production em leitura: versão/build, identidade de DB/Redis/Supabase,
   flags, integrações, observabilidade, backup e target de rollback. Não copiar
   recursos, fixtures ou secrets de staging.
4. Com todos os gates exigidos satisfeitos, promover somente com Secretária OFF;
   validar health e zero chamadas pagas. Rollback automático se health falhar.
5. Implementar/revisar admissão produtiva restrita preservando tenant, papel,
   confirmação, idempotência e kill switch. Não substituir a proibição atual por
   acesso amplo. O par produtivo ainda precisa ser explicitamente escolhido.
6. Após health e isolamento: leitura; depois apresentar BEFORE/AFTER/reversão de
   uma mutation pequena e aguardar a autorização específica exigida pelo usuário.

**READY_FOR_CONTROLLED_PILOT = NO.** Nenhum tenant/user produtivo foi escolhido,
nenhum canário foi habilitado e nenhum rollout geral foi iniciado.
