# Revisão visual dos planos — 13/09/2026

final result: passed

## Referência e evidências

- Referência selecionada pelo responsável na conversa “Avaliar integração com Mercado Pago”: `docs/design/pricing-approved-2026-09-13.png`, 1653 × 952 pixels.
- Implementação: `http://127.0.0.1:3067/#planos`, screenshot `docs/design/pricing-implemented-2026-09-13.png`, viewport CSS 1653 × 1100, densidade 1.
- Celular: `docs/design/pricing-mobile-2026-09-13.png`, viewport CSS 320 × 844, densidade 1. Também conferido em 390 × 844.
- Comparação feita com referência e screenshot apresentados juntos na mesma chamada de inspeção. A screenshot inclui cabeçalho/rodapé da seção; a comparação considera os limites dos quatro cards, sem confundir esse contexto com diferenças do desenho. Mesma largura de viewport; não foi executado diff automático de pixels.
- Estado comparável: mensal, Equipe com 5 agendas, IA bloqueada. A referência original foi ajustada por dois pedidos posteriores: violeta ligeiramente mais claro e valores anuais inteiros.

## Achados e correções

1. P1 resolvido: a primeira versão apresentava quatro planos técnicos e omitia IA. Refeito como Individual, Essencial, Equipe com seletor 5/10 e Everflair IA “Em breve”.
2. P2 resolvido: primeira comparação encontrou tipografia pequena no desktop. Aumentados títulos, preços, listas e conteúdo de IA no breakpoint largo; nova captura comparada à referência.
3. A cor final usa o degradê #634b7f → #70528d → #80629b, conforme pedido posterior de clareamento. Branco permanece legível; CTA e seletor usam lavanda clara.
4. P2 resolvido na continuidade: “Equipe · 10 agendas · 12 agendas” foi substituído por “Equipe · 12 agendas” no cadastro e na confirmação quando há dois adicionais.

Nenhum achado P0/P1/P2 permanece. Detalhe P3: ícones de biblioteca Lucide (incluindo AudioLines) têm traço e forma diferentes da imagem gerada; a prévia usa o ícone de voz compacto, sem reproduzir literalmente a onda decorativa longa. Não há fotos ou ilustrações raster nesta seção a gerar.

## Superfícies verificadas

- Tipografia: fonte sans existente do produto, hierarquia de títulos/preços, valores legíveis e sem truncamento. Diferença óptica pequena em relação à tipografia da imagem gerada é aceitável.
- Espaçamento: quatro colunas no desktop, duas no tablet e uma no celular; notas e CTAs alinhados; cantos arredondados; seletor mensal/anual centralizado. A seção mantém o cabeçalho da landing existente.
- Cores: branco e fundo claro, card Equipe violeta matte, lavanda nos controles, sem brilho excessivo. Clareamento posterior é intencional.
- Imagens/ícones: ícones vetoriais da biblioteca existente, sem placeholder; nenhum asset fotográfico exigido pela referência desta seção.
- Conteúdo: nomes, capacidades, recursos e IA futura presentes. Textos de cobrança se adaptam à flag desligada; anual é total por 12 meses. Valores anuais inteiros são alteração posterior solicitada.

## Interações e verificações

- Mensal/anual atualiza valores, economia e links.
- Equipe 5/10 muda o código de contratação correto; adicionais aparecem somente com 10 agendas.
- Duas agendas extras no anual preservam plano, ciclo, capacidade e parâmetros no cadastro.
- Ao voltar para 5 agendas, o link envia zero adicionais.
- IA sem preço, sem link de compra e botão nativo desativado.
- Cadastro confirma plano, capacidade e valor; não foi enviada conta ou compra por esse formulário.
- Em 320 e 390 pixels, largura do documento não excede viewport; controles e preço anual cabem no card.
- Console da landing: nenhum erro retornado na consulta realizada.
- Testes de componente cobrem a seleção anual com adicionais, retorno a 5 agendas, links e bloqueio da IA.

## Checklist

- [x] Referência original preservada no repositório.
- [x] Composição, estados, cores e tipografia comparados visualmente.
- [x] Fluxo principal e versão mobile verificados.
- [x] Respeitadas as revisões de violeta e arredondamento anual.
- [x] Sem pendência visual bloqueante.

Este resultado é de QA visual e interação local; não declara aprovação do CI nem ativação de cobrança em produção.
