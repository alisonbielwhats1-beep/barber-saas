# Planos atuais e cortesia administrativa — 09/10/2026

## Escopo e estado

Implementação da PR #169 integrada em `230f3216a73227ed381053ff1e30c449d1432e81`, após autorização explícita do responsável em 09/10/2026. Migration 032 aplicada e verificada em Production; primeira publicação com flag desligada confirmada. Ativação e operação da Bianca registradas abaixo. Nenhum dado de cliente foi excluído ou arquivado durante este trabalho.

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
- Bateria completa local: 10.237 passaram, 3 ignorados e 2 falharam em `secretary-free-use-mission` sob concorrência com build; repetição isolada, sem alterar testes: 20 passaram/1 ignorado. CI final confirmou 10.239 testes aprovados e 3 ignorados, em 659 arquivos.
- Novos testes de cortesia: 18 passaram, incluindo estoque atual, isolamento de papel e capacidade menor de checkout pendente.
- Playwright Chromium: concessão administrativa e confirmação em HQ passaram em 390/1440 px, sem erros de página; limites externos da janela verificados, capturas inspecionadas.
- CI: preparação descartável corrigida para criar a role app_runtime restrita e replicar a leitura pública de Salon para a role sintética após suítes que alteram suas policies. RLS da concessão permanece real e inalterada. Run `37957068690`: `check` e `schema-smoke` aprovados; Auth/SMTP run `37957068694` aprovado na repetição, sem alteração de testes. Lint, TypeScript, testes, build, PostgreSQL, restauração e jornadas responsivas aprovados.
- Preview publicado; home HTTP 200. Rotas administrativas respondem HTTP 503 com “Ambiente de homologação ainda não foi configurado com segurança”. A proteção foi preservada; esse Preview não constitui validação funcional remota. Não há autorização para tratar o banco compartilhado como staging. PostgreSQL local é descartável, em `127.0.0.1:55449/plan_grants_test`; não é staging remoto nem Production.

## Homologação e publicação autorizada

- Codespace: cópia sintética isolada `everflair_grants_staging_20261009`, derivada do banco de homologação existente. Backup/restauração conferidos, 032 aplicada duas vezes, 6/6 testes PostgreSQL aprovados. Coluna antiga `coverShowName` ausente na cópia: migration 028 aplicada somente à cópia. Fingerprints do banco original de homologação preservados. Codespace confirmado `Shutdown` ao encerrar.
- Production identificada como Supabase `barber-saas` / `vshnatkzxdekkvqttvbv`, PostgreSQL 17.6. Role `app_runtime` sem superuser/BYPASSRLS. Preflight 032 e pré-requisitos conferidos; nenhuma migration antiga reaplicada.
- Backup prévio das linhas potencialmente afetadas e metadados, criptografado no servidor e mantido fora do Git em diretório privado. Decifragem validada apenas em memória: 113.954 bytes; SHA-256 `a3232f35fbc7530d9e07dce14b2f184956fbd0a777a4aeb8685f3074dfb8eb9a`. Não é backup integral da instância. A migration é aditiva e não altera dados existentes.
- Aplicação `salon_plan_grants_032` confirmada e `032_salon_plan_grants.verify.sql` aprovado. Fingerprints antes/depois iguais em 13 tabelas: Salon, profissionais, serviços, clientes, agendamentos, contratos/eventos/cobranças e tabelas HQ. Bianca e Studio Martinelli preservados.
- Primeira publicação `dpl_9axqNE9XAXKwG1zubiv7ytfyerxh`, commit `230f3216`, `READY`, domínio `everflair.com.br`, com flag desligada. Home e página Bianca HTTP 200; Estabelecimentos/HQ verificados autenticados; nenhum log error/fatal encontrado no recorte verificado.
- Segunda publicação do mesmo commit, `dpl_3rHhDeiuDxUgNXAdnGWuLUFtWexz`, `READY`, domínio canônico confirmado, com `PLATFORM_PLAN_GRANTS_ENABLED=true`. Nenhuma outra configuração de ambiente alterada.
- Operação real autorizada executada uma vez pela UI administrativa: Bianca `studio-bianca-correia`, Individual, referência 3990 centavos, uma agenda, cortesia até `2026-10-19`. Registro `7a8e955d-24e9-4a11-9861-be92b702a352`, `endsAt=2026-10-20T03:00:00Z`, não revogado. Identidade da proprietária conferida antes da confirmação. `Salon.plan=FREE` preservado por desenho; benefícios vêm da concessão vigente. Zero contratos da Bianca.
- Estado confirmado na tela Estabelecimentos, listagem e ficha HQ, além da consulta somente leitura. HQ ganhou exatamente uma conta, um cliente em Teste e uma atividade. As outras dez tabelas acompanhadas mantiveram fingerprints idênticos; Martinelli segue `PRO/APPROVED`. Zero cobranças ou pagamentos novos. Nenhum log error/fatal encontrado no deployment no recorte final de dez minutos.
- Página pública e catálogo carregaram com 44 serviços, inclusive lobuloplastia R$180/par, 80 minutos e sem data inicial; serviços variáveis exibem "a partir de". Expediente da profissional conferido em leitura: segunda a sexta 09–20h, sábado 08–18h. O resumo público ainda usa a faixa geral do estabelecimento (08–20h), e não o expediente específico de cada dia; limitação visual preexistente, sem mudança da agenda nesta publicação.
- Limite da conferência: a aba autenticada da proprietária no Chrome não respondeu ao controle do navegador (timeout de foco). Não houve nova reserva nem exclusão de teste em Production. Jornada de concessão/HQ e responsividade foram executadas com dados sintéticos no CI; as verificações de Production usaram somente navegação/leitura e a concessão real autorizada.
