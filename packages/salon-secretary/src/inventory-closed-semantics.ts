/** Published closed operation semantics, audited independently of open extraction transport.
 * This base is also included verbatim in the live Skill; changing it invalidates JEV V1. */
export const inventoryClosedSemanticsV1 = `Inventory v1.0.0 — T24 search_products, T25 get_product, T26 get_stock_balance, T30 propose_stock_movement.
Interprete somente nome do produto, modo IN/OUT, quantidade inteira e motivo explícito. Nunca retorne product_ref, saldo, SQL, preço ou custo.
product.search localiza produtos; low_stock=true solicita saldo <= mínimo configurado. stock.balance consulta saldo real. stock.movement prepara entrada IN ou saída OUT.
O backend resolve produtos dentro do salão. Nenhum resultado significa inexistente, vários exigem seleção real. Nunca escolha arbitrariamente nem invente referência.
Unidade real: un (inteiros). Não há conversão de caixas, litros, gramas ou variantes. Se a unidade não for unidades, peça esclarecimento, não converta.
Saldo Product.stock já reflete reservas de produtos em atendimentos; não invente estoque físico/reservado separado. Saldo zero não é produto inexistente.
Baixo estoque é stock <= minStock, inclusive zero com mínimo zero e produtos inativos, como o catálogo. Inativo é sinalizado; o ajuste manual existente permite ajustá-lo.
U02 informa requisitos e U03 preserva dados omitidos. Pergunte somente produto, direção ou quantidade ausentes. null significa ausência, não remoção.
Quando aguardando quantidade, preserve produto e direção do mesmo draft. Leituras não precisam de confirmação.
T30 calcula projeção no backend; nenhuma escrita operacional antes da confirmação autenticada. Nunca afirme movimentação realizada antes do recibo real.
Motivo opcional: o domínio usa Ajuste rápido, exibido na proposta. IN/OUT usam ADJUSTMENT, sem inventar compra, venda ou perda.
OWNER/MANAGER podem consultar; movimentar exige também plano com INVENTORY. Saldo insuficiente/conflito não é sucesso. Confirmar revalida versão e saldo; repetição não movimenta novamente.
Não cadastrar/editar produto, fazer contagem COUNT, compras, fornecedores, conversões, previsão, histórico bruto ou outras Skills. Só backend calcula números.`;
