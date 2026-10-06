# Services T18 — alteração segura, sem chamada real

Implementação isolada em `codex/service-create-mvp`, baseada em `9b92138` e no
MVP aprovado. Sem migration, deploy, alterações produtivas ou outros agentes.

## Contrato e reutilização

Continua um Agent normal e uma única Function Tool (`upsert_action_draft`).
A extração acrescenta `operation` (`service.create`/`service.change`) e
`target_name` (nome atual citado). `name` significa novo nome, nunca a referência
do registro. Nenhum parâmetro service_ref, tenant ou identidade é exposto ao modelo.
Argumentos inesperados são rejeitados. Os campos anteriores de criação continuam
compatíveis e ausência/null do modelo continua significando omissão.

U02 agora informa também os requisitos de service.change: ao menos um patch
explícito entre name/priceCents/durationMin e alvo resolvido pelo servidor.
U03 mantém o diário AuditLog existente, com mudança opcional no draft:

```
change: {
  service_ref, service_revision,
  before: { name, priceCents, durationMin },
  patch: { somente campos explicitamente solicitados },
  price_type: FIXED | FROM
}
```

`proposeServiceChange(tx, actor, { draft_ref, draft_revision })` é T18.
Reutiliza o mesmo produtor de proposta de T17: autorização, lock do draft,
versão/expiração, hash, journal e preview. `fields` contém o estado depois;
`change.before` o estado anterior e `change.patch` o patch aprovado.
O hash vincula os campos, o alvo real, a versão e o patch. O nome histórico
SERVICE_CREATE_MVP do journal e confirmServiceCreate foi mantido por compatibilidade;
o confirmador agora despacha criação ou alteração conforme a proposta persistida.
Nenhum executor genérico ou segunda infraestrutura foi criado.

## Localização e seleção

`findCatalogServices` consulta Service com salonId autenticado e contains sem
distinção de maiúsculas. Não elimina acentos nem usa correspondência difusa.
Até 20 candidatos são apresentados; acima disso, exige refinar o nome.
Zero resultados retorna mensagem sem gravar draft/proposta/serviço (usage técnico
continua sendo registrado). Um candidato resolve o ID internamente; vários
exigem seleção pela nova ação autenticada selectSecretaryService. A escolha deve
pertencer aos candidatos da sessão e é reconsultada no mesmo salão.
Nenhuma inferência adicional ocorre para selecionar, propor ou confirmar.

## Patch, proposta e execução

A normalização de nome aprovada continua aplicada antes de U03.
Campos omitidos preservam valores. Exemplo de preview:

```
Nome: Massagem (sem alteração)
Preço: R$ 50,00 → R$ 60,00
Duração: 60 minutos (sem alteração)
Demais campos e relações preservados.
```

Preço FROM continua FROM e é mostrado como “A partir de”. Descrição, categoria,
custo, ativo, variante, recurso, processamento e finalização não entram no patch
T18. A duração nova precisa comportar processamento/finalização já existentes.
Renomear serviço com variantGroup é recusado, pois seu nome deriva das variantes.
Recursos inativos continuam sujeitos à validação existente do catálogo.

Confirmação usa a mesma action autenticada e revalida papel, salão, propriedade,
draft e proposta. `updateCatalogService` recebe opcionalmente a revisão aprovada;
nesse caminho valida exclusivamente os três campos e grava somente o patch.
Chamadores anteriores do domínio mantêm seu comportamento.

## Concorrência e idempotência

Service não possui updatedAt/version. Usa-se xmin::text, a versão da linha
PostgreSQL, sem alteração de schema. A leitura inicial usa FOR SHARE; T18 revalida
a versão e a confirmação bloqueia FOR UPDATE antes de comparar xmin e atualizar.
Uma escrita concorrente invalida a proposta, inclusive mudança seguida de retorno
aos mesmos valores (ABA). Restauração/freeze que torne a versão incompatível exige
nova proposta; não é uma versão de negócio durável para sincronização externa.

Locks do draft e recibo persistido reutilizados: a repetição retorna duplicate=true
com o resultado original, sem UPDATE adicional. Atualização e recibo ficam na mesma
transação. Revogação de acesso também bloqueia replay. Conflito SERVICE_CHANGED
encerra a sessão e informa que uma nova proposta é necessária.

## Validação e ambiente

Testes novos usam modelo ScriptedServicesModel, com fetch bloqueado, e PostgreSQL
descartável 127.0.0.1:55441/everflair_service_mvp. Antes das fixtures o helper
assertMvpTestDatabase confirma banco, porta e diretório do cluster. Administrador
é usado somente para fixtures sintéticas; domínio/testes funcionais usam
mvp_service_runtime sem superuser/BYPASSRLS e com FORCE RLS.

Cobertura: preço/duração/nome isoladamente; demais colunas preservadas; nenhuma
alteração antes da confirmação; inexistente; ambiguidade; seleção autenticada;
outro tenant; repetição e confirmação concorrente; xmin intacto no replay;
conflito ABA; revisão antiga; patches inválidos; FROM; variante; revogação de papel;
criação anterior ainda com duas inferências mockadas e uma inserção.

Não houve teste real de interpretação de alteração pelo Luna. Sessões e seleção
continuam em memória, locais ao processo, com o mesmo TTL e limite do MVP.
SALON_SECRETARY_ALLOW_PAID_CALLS=false; credencial, projeto e limites inalterados.

## Rollback

Manter a flag paga false. Reverter apenas os acréscimos T18 nos arquivos do
catálogo/contratos/journal/coordenador, pacote Services e interface/actions,
preservando as alterações anteriores ainda sem commit. Não usar reset/clean.
Não há rollback de schema. Preservar recibos/AuditLog; versões anteriores não
entendem registros com change, portanto não reabrir essas sessões no código antigo.
Nenhum rollback de dados reais é necessário: as escritas desta etapa são fixtures
e alterações de teste em salões sintéticos novos.

## Arquivos deste incremento

- `src/lib/service-catalog.ts`: localização, snapshot xmin e atualização condicionada.
- `src/lib/service-contract.ts`: requisitos U02 de alteração.
- `src/lib/service-create-mvp.ts`: extensão do journal comum, T18 e confirmação.
- `src/lib/salon-secretary.ts`: coordenação, seleção e mensagens determinísticas.
- `packages/salon-secretary/src/index.ts`: metadados de interpretação na Function Tool existente.
- `packages/salon-secretary/src/services-skill.ts`: Services create/change.
- `src/app/(admin)/servicos/secretaria/actions.ts`: seleção autenticada e erro de conflito.
- `src/app/(admin)/servicos/secretaria/secretary-chat.tsx`: candidatos e botão de alteração.
- `src/app/(admin)/servicos/secretaria/page.tsx`: descrição do escopo.
- `src/lib/__tests__/service-change.integration.test.ts`: dez testes PostgreSQL/fakes.
- `src/lib/__tests__/salon-secretary-ui.test.tsx`: seleção explícita na interface.
- Este relatório.

Resultados: dez testes PostgreSQL passaram; suíte completa de 223 arquivos e
1.227 testes passou; lint, TypeScript e build (61 páginas estáticas) passaram. O serviço do ensaio pago anterior
permanece Massagem/R$50/60 minutos e seus três eventos terminais reais anteriores
foram preservados. Zero chamadas reais nesta execução. Cluster encerrado após os
testes; nenhuma mudança em chave, projeto, limites ou flag persistida.
