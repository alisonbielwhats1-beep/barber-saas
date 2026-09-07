# Demonstração enriquecida — 07/09/2026

Complementação solicitada pelo responsável para a conta persistente de
apresentação já autorizada no Supabase. Dados e retratos são fictícios; imagens
de portfólio são referências ilustrativas, sem atribuição de trabalhos reais.

## Conteúdo confirmado

No estabelecimento `Everflair Studio · Demonstração`,
`everflair-apresentacao`, projeto `vshnatkzxdekkvqttvbv`:

| Conteúdo | Total |
| --- | ---: |
| Profissionais com retratos ilustrativos | 5 |
| Serviços com categoria, descrição e imagem | 20 |
| Clientes | 60 |
| Público feminino / masculino / outro / não informado | 30 / 26 / 2 / 2 |
| Produtos com fotos e informações de estoque | 15 |
| Referências no portfólio | 12 |
| Agendamentos de 24/07 a 07/10/2026 | 1.802 |
| Agendamentos em 07/09 | 28 |
| Recebimentos históricos fictícios | 942 |
| Despesas demonstrativas | 12 |
| Pacotes / aquisições demonstrativas | 4 / 13 |

Os indicadores usam os próprios registros: receita por público, serviços,
profissionais, ticket médio, ausências, cancelamentos e pendências. Não foram
injetados números fixos na interface. Agendamentos futuros continuam pendentes
ou confirmados; nenhum foi marcado em atendimento antes do horário.

O banco local exclusivamente sintético também foi enriquecido. O Studio local
tem os mesmos totais; o Barber local tem 1.795 agendamentos e 27 no dia 07/09,
pois possui agenda anterior diferente e um bloqueio manual que foi preservado.
Nenhum dado produtivo foi copiado para desenvolvimento.

## Arquivos e imagens

- `public/images/demo-enrichment/`: cinco retratos fictícios e três imagens
  ilustrativas de produtos, gerados por IA, usados no ambiente local.
- Em Production, as oito imagens foram enviadas pelo endpoint autenticado de
  upload, com sessão OWNER da conta demonstrativa, ao bucket existente
  `salon-assets`, exclusivamente no caminho do estabelecimento.
- Serviços e portfólio utilizam imagens ilustrativas já publicadas.
- Gerador administrativo, plano de recuperação, evidências e acessos ficam em
  diretório privado fora do Git. As senhas existentes foram mantidas.

## Controles e conferência

Preflight confirmou salon, slug, proprietário e ausência de clientes reais no
alvo. Backup lógico criptografado anterior à escrita, decifrado apenas em
memória para conferência: 204640 bytes, SHA-256
`205bd0efa45239fbd542020d049109b9610f9a4bb4f627d601a90c25a85189f7`.
AppointmentEvent estava vazio no tenant e foi tratado como inclusão aditiva.

Transação com guarda de identidade, bloqueio consultivo, IDs determinísticos,
escopo explícito e GUCs do tenant. A operação administrativa preservou os
agendamentos anteriores, credenciais, RLS e a role runtime sem BYPASSRLS.
Não houve alteração de schema, migration, reset ou envio de mensagens.

A conferência de integridade encontrou zero sobreposições entre profissionais,
zero novos agendamentos sobre bloqueios e zero agendamentos sem snapshot de
serviço. Todos os profissionais e produtos têm foto cadastrada.

Contagens e hashes confirmaram que os registros anteriores dos demais tenants
foram preservados nas 20 tabelas conferidas, além de AppointmentEvent. Durante
a janela houve um agendamento PUBLIC de outro tenant às 04:31 UTC, anterior
à complementação; ao separar essa inclusão concorrente, os 407 agendamentos
e 411 snapshots externos originais mantiveram exatamente os mesmos hashes.
Esse agendamento concorrente não foi alterado.

Recuperação sem apagar histórico: erro antes do commit reverte a transação;
após commit, eventual suspensão do tenant demonstrativo ou restauração de
metadados exige operação administrativa própria. Backup privado preservado.

Esta complementação de dados já está disponível na conta de apresentação.
A revisão de interface da branch `codex/color-and-demo` continua no PR #80;
não houve novo deploy de código nesta operação.

Conferência visual autenticada: agenda local com os cinco retratos e bloqueio
preservado; análises complementares com público feminino/masculino; profissionais,
produtos e portfólio online com fotos carregadas. Verificações locais:
`npm run lint` e `npx tsc --noEmit --incremental false` passaram;
`npm test`: 146 arquivos, 696 testes aprovados. O build do commit com os novos
assets é executado no CI do PR #80 para preservar o servidor local aberto.
