# Gate 4.0B — evidências de validação do runner

Worktree: `D:\Projetos\barber-saas\.worktrees\service-create-mvp`.
Branch local: `codex/secretary-runner-preflight`. Mudanças anteriores preservadas; sem fetch/PR/deploy neste Gate offline.

## Comandos/resultados

| Comando | Resultado |
|---|---|
| `node --import tsx scripts/preflight-hard-conversations.ts --dry-run` | Exit 0; 60 casos, 77 turnos, zero fixture inválida, zero chamada real |
| Novos runner/runtime probes (incluídos na suíte final) | 100 testes: 84 runner/fixtures/guards + 16 sondas de coordenadores |
| `npm test -- --maxWorkers=2 --testTimeout=30000` | Exit 0; **2208/2208**, 255 arquivos, 147,62s |
| `npm run lint` | Exit 0 |
| `npx --no-install tsc --noEmit --incremental false` | Exit 0 |
| `npm run build` | Exit 0; build Next/Prisma concluído offline, páginas geradas, sem deploy |

Suite inclui conversational primitives, drafts, fast-path, batch/dependências, seis Skills, Communication, Router, JEV evaluation, Acceptance Policy, cost guard, Golden V2 e mocks de segurança. Integrações `*.integration.test.ts` que exigem PostgreSQL foram excluídas pelo script padrão. Nenhuma alegação de validação PostgreSQL/RLS real é feita.

Rede bloqueada durante comandos de validação por preload local que rejeita fetch, http/https.request e socket.connect. Flags de processo false. Build usa fixture local já existente de Google Fonts, secret **sintético** de build e telemetria Next desativada; não baixou fontes/secrets. Não houve rede para contornar falha.

O primeiro passe de TypeScript identificou tipo incompleto do grafo e diferença de assinatura `z.record` entre Zod 3/4; corrigidos somente nos novos arquivos. A primeira importação das sondas precisou preservar exports de schemas dos mocks via `importOriginal`; corrigida. `tsx` CLI foi substituído por `node --import tsx` porque seu IPC usa socket bloqueado. Checks finais acima validam o estado corrigido. Não houve mudança em arquivos congelados para corrigir testes.

## Verificações independentes

- Manifest original e 118 arquivos protegidos conferidos antes de cada turno e ao finalizar o dry-run.
- Snapshot sintético materializado por caso com hash próprio, sem persistência/CRUD e sem alterar expected.
- Availability usa função de domínio real `findVisitPlan`: overlap completo, fim da jornada, habilitação e recurso exclusivo.
- Sondas reais de `applySchedulingInterpretation`: i01–i05 pedem o conjunto mínimo atual; a02/a04 selecionam entre opções; a09 não inventa serviço; correção mantém draft/revisão e invalida profissional.
- a01 e a08 preservam evidência da aproximação auto-resolvida atual, sem tratá-la como design correto.
- i13/d08/m06/m10: EXACT sem aspas rejeitado por `reconcileMessageContent`, mensagem congelada intacta.
- Referência de outro tenant não é retornada pelo port; teste de duplicidade Alisson separado do manifest.
- Runner mantém conversa/turno, detecta troca indevida de draft, recusa modo real e tipos/wire inesperados, conserva null para métrica não medida.
- `InferenceBudget`: 77 reservas = US$0,6622 histórico; tentativa 78, input >64k e output >1200 rejeitados.
- `.env.local` continua ignorado/não tracked; apenas modelo/flags não secretos foram verificados. GPT-6 Luna, paid=false, Router=false. Nenhuma chave/URL de conexão foi exibida.

## Limitações / decisão

Dry-run estrutural aprovado. **Execução real ainda bloqueada**: coletor possui schema/guards e porta de coordenação, mas ainda não existe ligação completa, auditada, do runtime/SDK a uma observação semântica independente por cada um dos 77 turnos. A porta estrutural não simula resolução de linguagem, nem declara sucesso nos checkpoints. Também falta reconfirmação de tarifa oficial antes da rede e nova autorização real.

Os 26 READY são compatibilidade prévia de contrato, não acurácia medida. Os 31 DESIGN_TARGET são classificação conservadora do checkpoint integral; não significam que toda a funcionalidade correspondente está ausente. Cenários parcialmente suportados permanecem identificados sem relaxar expected. O relatório JSON é uma camada nova: nenhum resultado histórico foi reclassificado no arquivo de origem.

Rollback restrito às adições enumeradas no relatório principal e à entrada de STATUS_ATUAL. Sem rollback de banco, runtime, credencial ou recurso remoto. Zero chamadas JEV/OpenAI/Meta; zero confirmação; zero operação de negócio; zero deploy.
