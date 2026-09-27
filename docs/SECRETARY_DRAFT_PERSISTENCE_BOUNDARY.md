# Fronteira de persistência do estado conversacional

Durante a estabilização posterior à Golden v9, a revisão reproduziu duas variantes da mesma divergência entre estado em memória e draft persistido:

- Atualizar campos ou seleção antes de uma gravação que falha deixava a UI e a próxima interpretação com dados que o draft não havia aceitado.
- Salvar o draft, falhar na preparação posterior da proposta e descartar toda a cópia de trabalho perdia a revisão já persistida. O próximo turno podia repetir `REVISION_CONFLICT`.

Os adapters de estoque, agenda, batch, clientes e mensagens publicam o estado conforme a fronteira efetiva de persistência. Antes do commit, a falha conserva o estado anterior. Depois do commit, a revisão aceita é preservada e a proposta permanece ausente. Isso não altera transações operacionais, permissões, confirmação, idempotência ou EXACT.

Clientes e mensagens compartilham `secretary-draft-transition.ts`. A transição usa uma cópia privada, publica o sucesso e, em erro, preserva somente drafts cuja revisão realmente avançou. Uma revisão aceita no cancelamento dependente pode sobreviver à falha do draft da mensagem; o conteúdo ainda não persistido da mensagem não é adotado. A preparação inicial de cancelamento com mensagem mantém o estado alcançável na sessão, assim como a preparação inicial do batch.

Evidência específica de clientes/mensagens: quatro falhas reproduzidas antes do reparo em `.demo/contact-persistence-before-domain.log`, com duas verificações de controle passando. Após o reparo, os nove testes específicos passaram em `.demo/contact-persistence-dependent.log`. O recorte atualizado com seis arquivos passou 73/73 em `.demo/contact-persistence-with-sdk-wrapper.log`. Uma rodada integrada anterior, concorrente com a migração do SDK, teve 65/72 e foi preservada como falha, sem alterar os expected. A suíte geral após a integração ainda é obrigatória.

Os fontes originais de clientes/mensagens e respectivos hashes foram preservados em `.demo/contact-persistence-before/`. O novo teste está em `src/lib/__tests__/secretary-contact-persistence-boundary.test.ts`. Nenhuma fixture ou expectativa histórica foi alterada neste reparo. São provas determinísticas com domínio simulado, não novas operações no banco nem chamadas à Luna.

As correções e provas adicionais de estoque e agenda/batch estão em `SECRETARY_INVENTORY_QUANTITY_GROUNDING.md` e `SECRETARY_CALENDAR_CLARIFICATION.md`. Este documento descreve uma correção local; não autoriza nem comprova prontidão de staging ou Production.
