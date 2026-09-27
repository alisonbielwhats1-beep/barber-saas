# Gate 2.5 — fronteira de dependências opcionais

## Causa e correção

O modelo retornou uma seleção Financial semanticamente correta com `depends_on: null`.
`selectionSchema` aceitava somente array ou propriedade ausente. A validação em
`runServicesTurn` rejeitou o retorno antes da execução da Function Tool e do T09.
Os mocks independentes omitiam a propriedade, portanto não cobriam essa representação.

O schema de transporte agora declara explicitamente nullable + optional. Em
`validateSelection`, somente `depends_on` é normalizado: ausência, null e [] resultam
em []. `CapabilitySelection` exige `string[]` internamente. O objeto recebido não é
mutado. Não há transformação Zod no schema enviado ao SDK, nem mudança de prompt.

Essa normalização não valida um grafo: ela apenas elimina uma representação opcional.
Pedidos independentes continuam rejeitando qualquer aresta. Pedidos dependentes
continuam passando por `startBatch` → `validateBatchPlan`, que exige chaves locais,
alvos existentes, ausência de ciclos/duplicatas, limite de duas operações e a relação
cancelar → criar no slot liberado. Null na dependência obrigatória da criação vira
[] e continua sendo rejeitado pelo domínio. Nenhum executor foi alterado.

## Outros opcionais auditados

- `item_key` e `released_slot_of`: já nullable/optional; null significa ausência na
  descoberta, mas o batch continua exigindo chave e origem válidas. Sem mudança.
- Campos Scheduling e `financial`: já nullable/optional; coordenadores filtram null
  antes de construir patches. Não se alterou a reconciliação temporal.
- Campos de `financial` (metrics, period, compare_period, group_by): já nullable;
  ausência é tratada pelo coordenador/requisitos existentes. Sem normalização nova.
- Nome, alvo, preço, duração, telefone e e-mail: nullable no transporte. Remoção
  explícita de contato continua dependendo de `clear_fields`.
- `requested_fields`, `clear_fields`, `skills` e `operations`: arrays obrigatórios;
  null continua inválido. `independent` continua boolean obrigatório.

## Revalidação real preparada, NÃO executada

Após nova autorização, revalidar ambiente descartável, OWNER sintético, projeto,
modelo, runtime, timezone e valor esperado para o dia efetivo nas fixtures existentes.
Não reutilizar automaticamente valores de ontem de uma execução em outra data.
Enviar uma única mensagem: “Quanto faturei ontem?”. Esperado: uma inferência,
Financial/service_revenue/yesterday, depends_on interno [], T09 e resposta calculada
pelo backend. Zero retry, confirmação ou escrita financeira. Interromper em qualquer
divergência material. Capturar usage/latência e retornar a flag paga a false no finally.
Não há autorização nesta correção para executar esse roteiro.

## Testes locais desta correção

- `secretary-selection-boundary.test.ts`: 18 testes, incluindo SDK → seleção
  automática → T09 real com SQL simulado, uma inferência fake e fetch proibido.
- Ausência/[]/null canônicos; tipos inválidos; arestas reais; erros específicos de
  destino inexistente/ciclo/aresta obrigatória ausente; referências arbitrárias;
  independentes Services/Customers/Scheduling; arrays não opcionais continuam estritos.
- `npm test`: 1348 testes / 232 arquivos aprovados na execução final, incluindo
  regressões locais de Services, Customers, Scheduling e Batch.
- `npm run lint` e `npx tsc --noEmit --incremental false`: aprovados.
- `npm run build`: aprovado, com segredo NextAuth sintético somente no processo de
  build local; nenhuma credencial/configuração persistente foi alterada.
- Primeira suíte encontrou mock incompleto (lookup de timezone), corrigido no teste,
  e timeout de 5s na varredura existente de senhas. Ambos passaram na reexecução.
- Nenhum teste PostgreSQL foi reexecutado; não houve alteração de domínio/banco.
  Flag paga false e zero chamadas reais à OpenAI.

## Rollback

Reverter apenas o nullable de depends_on e a normalização/tipo canônico em
`packages/salon-secretary/src/skill-registry.ts`; remover o novo teste
`secretary-selection-boundary.test.ts` e este documento se desejado. Isso restaura a
rejeição antiga de null. Não reverter o diretório inteiro: contém Gates aprovados
ainda não commitados. Nenhuma reversão de banco, fixture ou credencial é necessária.
