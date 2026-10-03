# Plano de implementação — evolução do Everflair

**Base:** `origin/master` `27255eb` em 24/09/2026. O produto já existe; este plano organiza **mudanças futuras** e a validação da fotografia atual. Não é autorização para migration, compra, integração paga ou promoção de Production. Requisitos são os IDs de [01_PRD.md](01_PRD.md).

## Regra de entrada

Para cada demanda, registrar: problema observado, pessoa afetada, regra em `DECISOES_PRODUTO.md`, comportamento atual reproduzido, telas/APIs/modelos envolvidos, critério de aceite, rollback e risco de tenant/dados. Se for requisito novo ou contrariar uma decisão, obter decisão do responsável antes de implementá-lo. Atualizar este blueprint na mesma alteração quando o contrato mudar.

## Sequência recomendada

| Etapa | Entrega concreta | Critério de saída |
| --- | --- | --- |
| 0. Fixar a base | Conferir `origin/master`, status canônico e versão implantada por leitura; listar mudanças em revisão separadas das já publicadas. | Escopo e commit base registrados, sem afirmar deploy pela presença de código. |
| 1. Fechar a jornada crítica | Revisar P-02 a P-06 com fluxo cliente → visita → operação → cancelamento/alteração/fila. Priorizar bugs reproduzíveis antes de novas telas. | E2E com dois tenants, vaga concorrida, visita atômica, reenvio e respostas fora de ordem em banco sintético. |
| 2. Consolidar a interface | Aplicar [04_UI_UX_DESIGN.md](04_UI_UX_DESIGN.md) às telas afetadas, preservando marca e regras. | Revisão visual 320/390/1440 px, teclado, foco, contraste, zoom e erros; sem overflow ou CTA oculto. |
| 3. Fechar contratos técnicos | Revisar APIs/actions, RLS, índices, jobs e dados tocados por cada fluxo. Se schema mudar, preparar migration aditiva e rollback/roll-forward. | Testes de domínio, PostgreSQL e `schema-smoke` provam integridade, isolamento e preservação de histórico. |
| 4. Validar assinatura e operação | Para P-07/P-08, testar baixa, retries de webhook, cancelamento, período pago, troca de plano e suspensão sem compras reais. | Casos de pagamento confirmado/repetido/falho e datas no fuso do salão passam em ambiente isolado; `Payment` e billing SaaS permanecem distintos. |
| 5. Publicar com controle | PR pequeno com matriz de risco, CI, Preview seguro, revisão e aprovação; promoção e smoke somente leitura depois. | Commit/deploy verificados e documentados; rollback conhecido. |

As etapas 1–4 são **fatias por demanda**, não uma reimplementação completa. Um ajuste visual não precisa de migration; um ajuste de banco não está pronto apenas por passar no build.

## Backlog já identificado, sem presumir publicação

1. **Fonte de verdade e ambientes:** versões antigas de `README.md`/roadmap ainda descrevem billing e recuperação anteriores. Manter seus resumos alinhados ao topo de `STATUS_ATUAL.md`. O projeto não tem Supabase de staging dedicado confirmado; Preview sem `APP_ENV=staging` continua bloqueando fluxos com dados. Não usar Production como substituto.
2. **Jornadas em revisão:** seleção de plano e limpeza protegida do HQ do PR #117, recebimentos de vários dias e refinamentos móveis aparecem no status como revisão/autorização, sem prova de promoção final. Cada frente precisa de revisão do commit integrado, CI e evidência própria antes de atualização de estado.
3. **Operação da conta:** Supabase Auth/recovery foi publicado em 20/09 com transição voluntária. Preservar contas legadas e acompanhar falhas de entrega/sessão sem forçar recuperação em massa.
4. **Melhorias posteriores:** Realtime por tenant, múltiplas unidades, IA contratável, automação de WhatsApp/SMS e cobrança manual `011` requerem briefs, desenho de dados, custos e autorização separados. Não agrupá-las em uma release de documentação.

## Pacote mínimo por PR de produto

- PRD: requisito e critério de aceite alterados; fluxo: caminho feliz, erro e recuperação; design: estados e responsividade; TRD/schema: impacto em autorização, tempo, dinheiro, índices e migrations.
- `npm run lint`, `npx tsc --noEmit --incremental false`, `npm test`, `npm run build`. Mudança de dados exige também integração PostgreSQL 16 descartável e `schema-smoke`; E2E da jornada afetada quando houver UI/fluxo.
- Testes com dois salões e papéis distintos para qualquer operação tenant-scoped. Testar duplicação e corrida para reservas, pagamentos, webhooks e fila.
- Preview deve usar somente dados sintéticos e ambiente identificado. Antes de SQL manual: preflight read-only, projeto inequívoco, backup recuperável, rollback/roll-forward e autorização explícita.
- Após aprovação e promoção: verificar home, rota alterada, sessão/autorização e erros de runtime da Vercel. Atualizar `STATUS_ATUAL.md` com commit, PR, deployment e resultados reais. Não marcar “feito” pelo plano ou pelo merge sozinho.

## Definição de pronto para este blueprint

Uma demanda futura está pronta para implementação quando o responsável consegue apontar o requisito, a jornada, o estado visual, a mudança de dados (ou sua ausência), os testes e o risco de release. Ela está concluída somente com evidência de CI e, se publicada, de deploy e smoke. Este documento por si só entrega planejamento, não altera o comportamento do aplicativo.
