# Planos atuais e cortesia administrativa — 09/10/2026

## Escopo e estado

Implementação na branch `codex/platform-plans-access`. **Ainda não implantada em Production.** A concessão da Bianca ainda depende da implantação e da operação administrativa verificada. Nenhum dado de cliente foi excluído ou arquivado durante este trabalho.

O catálogo é `src/lib/billing/catalog.ts`: Individual R$39,90/mês (1 agenda), Essencial R$79,90 (3), Equipe R$99,90 (5) e Equipe R$149,90 (10). O controle de aprovação não atribui mais planos legados. Aprovar/reativar preserva o plano existente, inclusive durante uma atualização de assinatura concorrente.

## Cortesia

`SalonPlanGrant` é uma concessão temporária, separada de contratos, faturas e recebimentos. Somente SUPER_ADMIN com contexto HQ pode conceder. A operação serializa o contrato e a capacidade, valida agendas e convites, grava termos do catálogo, vincula a conta HQ pelo salão e registra a autoria/motivo. A mesma chave repete o resultado sem duplicar concessões. Alteração de termos exige nova concessão; o registro anterior recebe apenas revogação.

A data final é inclusiva no fuso do salão. Para a Bianca, Individual até **19/10/2026**, o término é **20/10/2026 00:00 America/Sao_Paulo**, ou `2026-10-20T03:00:00Z`. Durante o prazo: uma agenda, reservas ilimitadas e recursos do plano. Créditos da Secretária não são concedidos. Depois do prazo retorna ao Grátis sem apagar agenda, serviços, clientes ou financeiro. **Não existe débito automático**: a proprietária precisa contratar para continuar; contratar antes do término inicia o fluxo pago imediatamente.

Não substitui planos legados nem qualquer assinatura existente. Uma assinatura paga ou em revisão prevalece sobre uma cortesia anterior. Um checkout pendente reserva sua capacidade menor. Não altera `Salon.plan`, não inventa `paidThrough` e não cria pagamentos para a cortesia.

## Exclusão e clientes protegidos

O SUPER_ADMIN pode excluir somente cadastros desativados e vazios, após inspeção atual e confirmação do slug. Os vínculos de notificações push, créditos da Secretária e cortesias agora são reconhecidos na inspeção: tabela vazia não bloqueia indevidamente; registros existentes bloqueiam. Novas dependências desconhecidas continuam bloqueadas por segurança. A interface lista os motivos e mantém a alternativa de arquivamento reversível. Não executar exclusão/arquivamento de clientes reais para validar.

**Studio Martinelli permanece intocado.** O pedido de permitir exclusão não autoriza apagar histórico comercial, agendamentos ou cobrança.

## Implantação controlada

1. Aguardar lint, TypeScript, testes, build, CI `schema-smoke` e Preview do PR. A migration 032 deve passar duas vezes em PostgreSQL descartável, com RLS/role sem BYPASS, snapshot e restauração do backup.
2. Obter aprovação de promoção e SQL manual conforme AGENTS.md/AMBIENTES.md; identificar projeto produtivo inequivocamente, verificar `032_salon_plan_grants.preflight.sql` e confirmar estruturas 020/023/024 existentes. Não reaplicar migrations antigas em Production.
3. Produzir backup verificável e testar restauração fora de Production. A 032 é aditiva; verificar fingerprints de clientes/contratos antes/depois, incluindo Martinelli. Aplicar somente `032_salon_plan_grants.sql`, seguido de `.verify.sql`.
4. Implantar código com `PLATFORM_PLAN_GRANTS_ENABLED=false`; ativar `true` somente após verificação da migration e do runtime `app_runtime`. HQ deve estar habilitado. Outros flags de cobrança mantêm seus valores.
5. Verificar home, HQ e Estabelecimentos sem mutações de teste; revisar logs de runtime.
6. Na operação autorizada da Bianca, confirmar slug `studio-bianca-correia`, e-mail informado pelo responsável e conta proprietária; conceder **INDIVIDUAL**, **2026-10-19**, motivo da concessão e confirmar uma única vez. Recarregar e conferir concessão, HQ, painel da proprietária e data. Não enviar mensagens nem criar reservas de teste.

## Rollback

Antes de concessões: desligar flag e reverter código; preservar tabela. Depois de concessões: desligar a flag remove os benefícios temporários; coordenar com o responsável antes. O arquivo `.rollback.sql` é inventário somente leitura e não apaga dados. Histórico/auditoria são imutáveis; revogação pelo administrador só muda `revokedAt`, nunca termos ou pagamentos.

## Evidências

- `npm run lint`: passou, 0 erros; 6 avisos preexistentes.
- `npx tsc --noEmit --incremental false`: passou antes dos últimos testes adicionais; build também validou tipos.
- `npm run build`: passou com URLs somente locais e segredo sintético.
- PostgreSQL 16 descartável: migration 032 aplicada duas vezes e verificada; 6 testes de concessão e 4 de exclusão/arquivamento passaram.
- 289 testes focados passaram após correção dos mocks e arquivamento dos bytes originais de `inventory-catalog.ts`. Os manifestos e hashes históricos não foram alterados; o leitor histórico existente valida o arquivo original, e o teste novo verifica a autorização do estoque atual.
- Bateria completa local: 10.237 passaram, 3 ignorados e 2 falharam em `secretary-free-use-mission` sob concorrência com build; repetição isolada, sem alterar testes: 20 passaram/1 ignorado. CI precisa confirmar a bateria completa.
- Novos testes de cortesia: 18 passaram, incluindo estoque atual, isolamento de papel e capacidade menor de checkout pendente.
- Playwright Chromium: concessão administrativa e confirmação em HQ passaram em 390/1440 px, sem erros de página; limites externos da janela verificados, capturas inspecionadas.
- CI: preparação descartável corrigida para criar a role app_runtime restrita e replicar a leitura pública de Salon para a role sintética após suítes que alteram suas policies. RLS da concessão permanece real e inalterada. Aguardar nova execução.
- Preview publicado; home HTTP 200. Rotas administrativas respondem HTTP 503 com “Ambiente de homologação ainda não foi configurado com segurança”. A proteção foi preservada; esse Preview não constitui validação funcional remota. Não há autorização para tratar o banco compartilhado como staging. PostgreSQL local é descartável, em `127.0.0.1:55449/plan_grants_test`; não é staging remoto nem Production.
