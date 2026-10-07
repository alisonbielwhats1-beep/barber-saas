# Blueprint do Everflair

Seis documentos para orientar mudanças no produto, inspirados nas categorias do reel compartilhado pelo responsável. Eles descrevem o **Everflair existente**, não um aplicativo novo nem os modelos privados oferecidos pelo autor do vídeo.

**Base de leitura:** `origin/master` em `27255eb` (24/09/2026). O estado implantado vem das seções mais recentes de [`../STATUS_ATUAL.md`](../STATUS_ATUAL.md); o código neste commit não comprova, por si só, a versão em Production. Mercado Pago consta como ativo no status de 20/09, enquanto a cobrança manual legada de `011_platform_billing` continua separada.

| Documento | Pergunta que responde |
| --- | --- |
| [01 — PRD](01_PRD.md) | Para quem é o produto, quais problemas resolve e o que precisa funcionar? |
| [02 — TRD](02_TRD.md) | Como a solução funciona e quais invariantes técnicos devem permanecer? |
| [03 — Fluxo do aplicativo](03_APP_FLOW.md) | Por onde cada pessoa passa e o que acontece em cada decisão? |
| [04 — Design UI/UX](04_UI_UX_DESIGN.md) | Como organizar telas, estados, linguagem visual e acessibilidade? |
| [05 — Esquema de backend](05_BACKEND_SCHEMA.md) | Quais entidades persistem os dados e como se relacionam? |
| [06 — Plano de implementação](06_IMPLEMENTATION_PLAN.md) | Como revisar, priorizar e entregar mudanças com segurança? |

**Atual** indica código em `27255eb` ou o status canônico; **decisão** indica regra aprovada em [`../DECISOES_PRODUTO.md`](../DECISOES_PRODUTO.md); **proposta** orienta uma mudança futura e não autoriza código, pagamento ou deploy. A fonte executável do banco continua sendo [`../../prisma/schema.prisma`](../../prisma/schema.prisma), migrations e RLS. Consulte [`../AMBIENTES.md`](../AMBIENTES.md) antes de testes com banco.

Não houve auditoria ao vivo da Production para estes documentos. Recursos registrados como em revisão no status, como seleção de planos do PR #117 e recebimentos de vários dias, não são tratados como implantados. A IA da landing está “Em breve”; os agentes do HQ são um domínio privado distinto.
