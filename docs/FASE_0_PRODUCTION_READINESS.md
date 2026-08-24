# Fase 0 — prontidão para produção

## Objetivo

Reduzir o risco de indisponibilidade, configuração incorreta e perda de dados
sem alterar a lógica da agenda, os dados dos salões ou as migrations
produtivas.

## Entregue no repositório

- `GET /api/health` executa uma consulta somente leitura e retorna `200` quando
  o runtime e o banco respondem; em falha retorna `503` sem expor host, erro,
  senha ou qualquer secret.
- `src/lib/runtime-contract.ts` valida a presença e a coerência mínima das
  variáveis de runtime sem imprimir seus valores.
- `npm run check:runtime` permite validar a configuração local/CI.
- O CI executa o contrato de ambiente antes de gerar o Prisma Client.
- `npm run typecheck` centraliza o comando de TypeScript usado pelo CI.
- Headers básicos de segurança são aplicados pelo `next.config.mjs`.
- Testes unitários cobrem health check saudável, indisponível, ausência de
  vazamento e separação entre homologação e produção.

## Como validar localmente

Com um `.env` de desenvolvimento apontando somente para PostgreSQL local:

```bash
npm run check:runtime
npm run lint
npm run typecheck
npm test
npm run build
```

O comando não deve ser executado com variáveis copiadas de Production.

## Checklist externo ainda necessário

Estas tarefas não são executadas automaticamente pelo código e exigem acesso
deliberado aos serviços:

- identificar inequivocamente o projeto Supabase de homologação e confirmar que
  ele é diferente do projeto de Production;
- configurar variáveis de Preview exclusivamente no projeto de homologação;
- executar uma conexão somente leitura ao `/api/health` da homologação;
- configurar monitoramento da URL `/api/health` com alerta para `503`;
- habilitar logs/alertas de erro, latência, `429`, `503`, cron, banco, storage e
  e-mail, sem registrar secrets ou dados pessoais;
- fazer backup e ensaiar restauração do Supabase fora de Production;
- proteger `master` com revisão obrigatória e checks do CI;
- executar smoke test visual e de jornada em Preview seguro antes de promover;
- após deploy, verificar `/`, `/api/health`, link público e login com uma conta
  de teste não produtiva.

## Critério para considerar a fase concluída

A fase só deve ser marcada como concluída depois de haver evidência registrada
de que:

1. CI passou com lint, TypeScript, testes, integração, schema smoke e build;
2. Preview usa banco de homologação inequivocamente separado;
3. `/api/health` retorna `200` na homologação e Production;
4. um backup foi restaurado em ambiente descartável;
5. uma jornada pública e uma jornada administrativa foram verificadas após o
   último deploy;
6. existe um responsável e um procedimento para responder a `503` ou erro de
   migration.

Nenhuma migration manual ou dado de Production é necessário para validar esta
entrega.
