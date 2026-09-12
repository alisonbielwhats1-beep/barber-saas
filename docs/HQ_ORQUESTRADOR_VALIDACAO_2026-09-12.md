# Validação real do orquestrador — 12/09/2026

Projeto `proj_48Zf5hXOzoiiCnIEJ4Rb3vN4`. SDK OpenAI 7.15.0, agentes salvos
com modelo `gpt-5.6-luna`, sem alterações de instruções/modelo/formato.

Seis mensagens fictícias concluíram todos os destinos permitidos. Cada ensaio
foi enviado pelo formulário local autenticado como SUPER_ADMIN. A resposta final
apareceu na página; as sessões foram depois consultadas diretamente na OpenAI.

| Caminho observado | Evento | Aprovação pendente | Duração somada |
|---|---|---|---|
| Triage → Chief | BUG_REPORT | Sim | 30.1 s |
| Triage → Sales → Chief | DEMO_REQUEST | Não | 33.6 s |
| Triage → Customer Success → Chief | CHURN_RISK | Não | 44.3 s |
| Triage → Product → Chief | FEATURE_REQUEST | Não | 39.7 s |
| Triage → Operations → Chief | INTERNAL_REQUEST | Não | 41.0 s |
| Triage → Marketing → Chief | MARKETING_OPPORTUNITY | Não | 35.2 s |

A mensagem de bug foi classificada como Chief direto mesmo com BUG_REPORT;
a sugestão de funcionalidade do Everflair foi encaminhada a Product. O backend
respeitou target_agent em ambos os casos, sem fabricar a classificação.

## Conferência nas sessões salvas

Nos seis caminhos, a consulta somente leitura confirmou:

- mensagem original, classificação validada e saída completa de Triage recebidas por Chief;
- resultado completo do especialista recebido por Chief, ou specialist=null no caminho direto;
- resposta final de Chief concluída;
- tools desativadas, multi_agent.enabled=false, environment.type=none e vault_ids vazio;
- instruções, modelo, configuração de texto/formato, raciocínio e nível de serviço
  idênticos aos agentes salvos nas 17 sessões (comparação sem expor os prompts);
- nenhuma execução dos especialistas não selecionados.

A auditoria descartou itens de raciocínio e commentary. Não foram consultados
dados de clientes nem gravados registros de CRM.

## Sessões verificadas

| Ensaio | Agente | Sessão |
|---|---|---|
| Chief | Triage | `sess_004f9a1644a7be00006aa5b1e3baa0819187ee0587794f3861` |
| Chief | Chief | `sess_0393b149095dfcf9006aa5b1f19b0081919a389038cf317305` |
| Sales | Triage | `sess_0671baa0cd3fe6c7006aa5b29079c081918c73ea3136c4ff04` |
| Sales | Sales | `sess_0debad380c2be3e6006aa5b29a9ebc81919cb0eec6a3959d16` |
| Sales | Chief | `sess_0a7ce5f8ae73e6df006aa5b2a5ef488191a64b981b3a60fffe` |
| Customer Success | Triage | `sess_064a74757d65c0cd006aa5b2dd00a88191a7587e66a419ca7d` |
| Customer Success | Customer Success | `sess_0d24fb04da1e9e35006aa5b2e769cc8191a275d65444e7f0ae` |
| Customer Success | Chief | `sess_0094f9cc9a11b485006aa5b2f4848c8191a93d1b279134d254` |
| Product | Triage | `sess_0323eef3bd6479b6006aa5b396b9548191b0df9df61ae68820` |
| Product | Product | `sess_0bc245201aaec568006aa5b3a0e90081919acb4e373611f7ef` |
| Product | Chief | `sess_06608fd2e58bc200006aa5b3af12e48191b21e3e3aba8e7370` |
| Operations | Triage | `sess_06a41e66946b2242006aa5b3f758fc8191bd4b3934aeeb958e` |
| Operations | Operations | `sess_0e1effeb106c2260006aa5b402b94c8191b83efa2188f8089b` |
| Operations | Chief | `sess_0bab9efe7ae7cc8c006aa5b410610c8191b607c5983717f391` |
| Marketing | Triage | `sess_063b6d1e8df67aaa006aa5b4c21c8c8191bdb46dfbf0326cd7` |
| Marketing | Marketing | `sess_053a00a32701291f006aa5b4ce7bb881918e16a6471f0649fa` |
| Marketing | Chief | `sess_0ebaa475ef3b64e8006aa5b4db499c8191a08845607a872a6c` |

## Prazo e tentativas

O primeiro pedido mais amplo de Marketing atingiu o prazo compartilhado de
45 segundos durante Chief. A OpenAI confirmou o turno cancelled na sessão
`sess_0a5a4a0bb6591f5b006aa5b479830081919959000d8784381f`, sem final_answer concluído.
Um novo pedido curto de slogan concluiu o caminho Marketing. O limite de
45 segundos permanece: solicitações demoradas podem ser interrompidas.

Foram registradas 19 tentativas: 12 iniciais sem execução confirmada durante
o diagnóstico, seis fluxos completos e um fluxo cancelado pelo prazo.
O responsável autorizou temporariamente até 20 tentativas/24h, mantendo uma
por minuto. A ampliação é exclusiva de desenvolvimento local, usa o mesmo
contador do projeto e expira às 22:05:17 UTC (19:05:17 de Brasília) de 12/09.
Depois retorna a dez. O registro local de ensaios conserva a contagem entre
reinícios; o limitador geral em desenvolvimento continua sendo por processo.

## Verificação automatizada e ambiente

Lint, TypeScript e 1.002 testes em 183 arquivos passaram, incluindo 95 testes
específicos do orquestrador. O build Next.js final
passou em checkout isolado com as mesmas fontes. O wrapper npm run build foi
bloqueado pela DLL Prisma em uso no Windows; npx next build usou o cliente
já gerado, com SHA-256 do schema idêntico, e concluiu todas as etapas.
A validação das respostas longas foi corrigida no coletor local e cruzada com
a página e com os itens de sessão da OpenAI, sem nova inferência.

Aplicativo em `http://localhost:3017/hq/agents/orchestrator`, PostgreSQL local
isolado e credenciais sintéticas em `.demo/ACESSO_LOCAL.md` (ignorado pelo Git).
Evidências detalhadas em `.demo/real-flow-audit.json`, respostas dos ensaios e
capturas locais. Sem publicação em Production, WhatsApp ou migration produtiva.
