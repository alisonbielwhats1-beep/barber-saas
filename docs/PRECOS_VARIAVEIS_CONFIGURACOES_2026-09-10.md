# Preços variáveis e configurações por assunto

Implementação autorizada pelo responsável. Branch `codex/variable-prices-settings`,
base `origin/master` `9840388`. Não representa implantação em Production.

## Comportamento

- Cadastro/edição do serviço: seletor nativo Fixo / A partir de, valor inicial,
  explicação de até 240 caracteres e prévia. Fixo mantém o fluxo anterior.
- Catálogo, seleção, barra de resumo e revisão mostram “A partir de”. A revisão
  usa “Valor inicial” quando ao menos um serviço varia, explicando que o valor
  final pode ser maior e será combinado antes do atendimento.
- Reservas preservam tipo e explicação no snapshot de cada serviço. Alterar o
  catálogo não muda os termos de reservas existentes, remarcações ou entradas
  já registradas na fila. Propostas de alteração carregam seus próprios termos.
- Mudança dos termos entre consulta e confirmação retorna `PRICE_CHANGED` e
  reverte a reserva, estoque e eventos dentro da mesma transação. Retry de uma
  confirmação já concluída continua retornando a mesma reserva.
- Acréscimos por dia/data seguem sendo calculados pelo servidor sobre o valor
  inicial. Não muda duração, conflito, cancelamento, permissão nem RLS.
- Configurações abre um índice com busca por nome, descrição e sinônimos, sem
  depender de acentos. Cada assunto abre sozinho; voltar preserva busca e
  campos ainda não salvos. Histórico do navegador e `#jornadas` são suportados.
- Tópicos refletem recursos existentes: vitrine, dados/regras, horários,
  acréscimos por dia, fechamentos, perfil, acessos, central de avisos, plano e
  primeiros passos. Nenhum recurso pago ou integração foi adicionado.

## Limites

Esta entrega comunica e preserva a condição de preço inicial. Não cria orçamento
remoto, aprovação digital de um valor final nem novo mecanismo de cobrança.
A comanda e os relatórios existentes continuam usando o valor registrado do
atendimento; uma evolução para negociar e lançar valores finais por serviço
exige um fluxo próprio. Não tratar o valor inicial como promessa de preço final.
Os serviços legados e seus agendamentos continuam FIXED.

## Migration 021

Quatro colunas novas: `Service.priceType/priceNote` e
`AppointmentService.priceType/priceNote`. Tipo textual com default constante
`FIXED`, nota nula, e duas constraints de consistência. Fila e propostas já usam
JSON e passam a preservar os mesmos atributos. Nenhuma tabela, registro,
policy ou grant é removido ou alterado pela migration.

Antes de Production:

1. Confirmar o projeto e a conexão direta com o responsável; não baixar secrets
   produtivos para este checkout. A execução produtiva requer autorização explícita.
2. Backup nativo ou dump criptografado, com restauração ensaiada; registrar hora,
   responsável e contagens. O CI prova backup/restore apenas com dados sintéticos.
3. Executar `021_variable_service_prices.preflight.sql` somente leitura. Comparar
   colunas/constraints existentes e RLS/grants; abortar em qualquer divergência.
4. Após testes descartáveis e homologação autorizada, aplicar `021...sql` uma vez.
5. Executar `021...verify.sql`, comparar preços e contagens anteriores e publicar
   somente o código com CI aprovado. A versão nova exige estas colunas.
6. Verificar home, serviços, reserva e configurações; verificar erros de runtime.

Rollback: antes de usar FROM, restaurar o código anterior mantendo as colunas.
Depois de usar FROM, preferir roll-forward, pois a versão antiga apresentaria
preços iniciais como fixos. O arquivo de rollback é um inventário somente leitura,
não apaga nem reclassifica reservas. Não aplicar a migration 011 de billing.

## Verificações

- Testes DOM: pesquisa, navegação, foco, retorno e preservação de edição; revisão
  de reserva com serviços fixos e variáveis.
- PostgreSQL: alteração do catálogo, remarcação com snapshots, termos alterados,
  rollback transacional, idempotência, promoção da fila e constraints inválidas.
- Schema smoke: predecessor real, backup/restauração, preflight, aplicação,
  reaplicação, comparação dos registros e configuração de segurança.
- Navegador: configurações em 320/390/1280px, cadastro pelo dono, revisão e reserva
  pelo cliente, histórico após editar catálogo, axe e capturas com dados fictícios.
- Resultados e links de CI/Preview serão registrados no PR. Production permanece
  sem alterações nesta preparação.

## Publicação autorizada em 11/09/2026

O responsável autorizou aplicar a migration e publicar. A numeração passou para
021 porque a migration 020 de HQ foi integrada e aplicada em outra entrega.
A integração com master passa novamente pelo CI antes da execução produtiva.

## Migration produtiva verificada

Em 11/09 às 01:27 UTC, após autorização explícita, a migration 021 foi aplicada
pelo conector Supabase ao projeto `barber-saas` / `vshnatkzxdekkvqttvbv`, versão
`20260911012714` / `product_021_variable_service_prices`. Preflight confirmou
colunas ausentes, identidade, constraints e runtime sem BYPASSRLS.
A integração com HQ 020 já passou pelas etapas de banco do CI 34550526778.

Backup delimitado às duas tabelas afetadas, com registros e metadados de schema,
criptografado no banco com OpenPGP/AES-256 antes de sair pelo conector. Arquivo
fora do Git em `%USERPROFILE%/.codex/backups/everflair/production-2026-09-11-pr93/`,
ACL restrita ao usuário e SYSTEM; chave em `../production-2026-09-07/keys`.
Decifragem somente em memória confirmou formato, contagens e SHA-256:
`3f9f36e8dd063d1ef1ff8cff9a16570863e3a655258c70c8d424d3713fac5951`, 721837 bytes.
A restauração funcional usa exclusivamente dados sintéticos no schema-smoke.

Verify passou; ENABLE/FORCE RLS e grants permaneceram iguais. Todos os registros
legados ficaram FIXED/null. Fingerprints JSONB das colunas anteriores iguais:

| Tabela | Registros | MD5 antes/depois |
|---|---:|---|
| Service | 160 | fd7bde037ac77a9371c09acf8e744f57 |
| AppointmentService | 2234 | 7cd1cc5a619fdcf64b7146a3308236d7 |

Nenhum seed, teste de escrita ou reaplicação de migration anterior foi executado
em Production. Recuperação continua por código anterior mantendo colunas;
após adoção de FROM, preferir roll-forward para não ocultar condições de preço.
A publicação usa merge em master e build Production pela integração Git da
Vercel, após aprovação do CI/Preview final. Evidência final de merge, deployment,
rotas e runtime será registrada no PR #93; os registros anteriores deste arquivo
que dizem "não aplicada" descrevem a preparação, concluída por esta seção.
