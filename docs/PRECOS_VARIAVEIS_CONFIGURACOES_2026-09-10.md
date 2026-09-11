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

## Migration 020

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
3. Executar `020_variable_service_prices.preflight.sql` somente leitura. Comparar
   colunas/constraints existentes e RLS/grants; abortar em qualquer divergência.
4. Após testes descartáveis e homologação autorizada, aplicar `020...sql` uma vez.
5. Executar `020...verify.sql`, comparar preços e contagens anteriores e publicar
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
