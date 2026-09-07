# Evolução de produto — Everflair

Base: origin/master a66a98b. Branch: codex/product-experience.
Este documento acompanha a solicitação de implementar as 12 frentes da auditoria.
Entrega no [PR #79](https://github.com/alisonbielwhats1-beep/barber-saas/pull/79).
Não representa implantação em produção. Resultado integrado nos checks do PR.

## Overview das 12 frentes implementadas

| Frente | Entrega | Onde conferir |
|---|---|---|
| 1. Identidade e interface | Marca animada, paleta Everflair, temas, contraste, ícones acessíveis e distribuição móvel | Entrada, Hoje e áreas administrativas |
| 2. Agenda | Fotos e nomes; gesto/teclado/toque; bloqueios recorrentes, intervalo/dia, revisão dos afetados, reabertura e expediente extra | Agenda |
| 3. Séries | Ocorrências futuras, novos horários, conflitos, motivo, aceite do cliente e resultado individual | Detalhe da reserva → série |
| 4. Fila flexível | Faixas de datas/horários, retirada pelo cliente, revisão de preço e confirmação por ordem compatível | Reserva pública e Agenda → expediente e fila |
| 5. Encaixes | Prioridade para bordas dos menores intervalos livres | Seleção de horário pelo cliente |
| 6. Serviços | Grupo/variação, processamento/finalização e snapshots por visita | Serviços |
| 7. Salas/equipamentos | Unidades, vínculo ao serviço, reserva exclusiva concorrente e liberação por cancelamento | Serviços → salas e equipamentos |
| 8. Cuidados | Anotações imutáveis e fotos privadas com consentimento | Detalhe do atendimento e histórico do cliente |
| 9. Beneficiários | Pessoas vinculadas ao titular, escolha de quem será atendido e nome separado | Agendamento público e visitas |
| 10. CRM/comunicação | Atalho do histórico à visita, filtros legíveis e confirmação manual do envio | Clientes e comunicação |
| 11. Indicadores/pacotes | Próximas ações, valores a receber, pedidos de encaixe, vencimento em 7 dias, saldo baixo e capacidade corrigida | Dashboard, relatórios, pacotes, equipe e marketing |
| 12. Validação | PostgreSQL/RLS/concorrência, jornadas autenticadas e 36 verificações visuais/acessíveis | CI e artefato browser-evidence |

### Ajustes encontrados na inspeção visual

- Ações verdes e faltas vermelhas em português; badges usam cores semânticas
  adequadas ao tema. Rótulos textuais acompanham as cores de status.
- Nomes acessíveis em menus e seletores, associação entre rótulos e campos,
  controles de toque maiores e tabelas roláveis acessíveis pelo teclado.
- Indicadores não cortam os nomes no celular; despesas têm descrição e valor
  em linhas próprias; métricas da equipe usam duas colunas no celular.
- Iniciais dos profissionais têm contraste calculado. Meta ausente não aparece
  como progresso de 0%; marketing sem clientes inativos não sugere “reativar 0”.
- Datas de vencimento preservam o dia de calendário entre servidor e navegador.
- QR legível nos dois temas; ferramentas de expediente/fila recolhíveis deixam
  a grade da agenda mais próxima do topo.

### Arquivos principais desta continuação

- Agenda: `src/app/(admin)/agenda/agenda-board.tsx`, `availability-panel.tsx`,
  `series-editor.tsx`, `flexible-panel.tsx`, `care-panel.tsx` e respectivas actions.
- Domínio: `src/lib/availability-recurrence.ts`, `flexible-waitlist.ts`,
  `slot-fit.ts` e operações centrais de agendamento.
- Catálogo: `src/app/(admin)/servicos/`; cliente: `src/app/book/[salonSlug]/agendar/`.
- Indicadores: `src/app/(admin)/dashboard/opportunities.tsx`, relatórios, pacotes,
  CRM, financeiro e profissionais. Temas: `src/app/globals.css`.
- Banco: `prisma/schema.prisma` e `prisma/sql/manual/019_product_depth.*.sql`.
- Testes: `tests/e2e/product-audit.spec.ts`, `product-operations.spec.ts`,
  `product-depth.spec.ts` e `src/lib/__tests__/product-depth-postgres.integration.test.ts`.

## Incremento implementado

- Agenda: bloqueio por intervalo/dia/vários dias, seleção de profissionais, motivo,
  reabertura auditada e visualização do bloqueio na grade diária.
- Bloqueios usam o lock do profissional compartilhado com reservas e preservam
  os compromissos existentes. A lista de afetados permite abrir cada reserva e
  cancelar selecionadas separadamente, com motivo, versão e resultado individual.
- Agenda: rolagem contida com cabeçalhos fixos, controles menos arredondados,
  status textual nos cartões com espaço e links para abrir uma reserva específica.
- Dashboard: capacidade desconta fechamentos e a união de ausências dentro da
  jornada; não duplica sobreposições. Rankings nomeiam faturamento e gráfico linear.
- Layout: área útil ampliada e margens reduzidas em desktop.
- WhatsApp: abrir o aplicativo não registra envio; exige confirmação manual.
- Estoque: alerta leva ao filtro de reposição.
- Cliente: catálogo público antes do login; APIs de reserva/fila continuam exigindo
  sessão. Cadastro apresenta o nome do estabelecimento validado pelo tenant.

## Comportamentos e limites da continuação

### Continuação autorizada — 019

As pendências abaixo receberam implementação nesta continuação. Não representam
publicação em produção; os checks do PR registram a validação de cada versão.

| Frente | Entrega candidata |
|---|---|
| Agenda | Gesto de seleção, alternativa por teclado/toque, recorrência semanal/quinzenal/4 semanas, bloqueios semana/mês/lista |
| Séries | Revisão de ocorrências futuras, seleção, conflitos e resultado individual; cliente com conta mantém aceite |
| Fila | Preferências de datas/horários, retirada pelo cliente e confirmação pela equipe respeitando FIFO compatível |
| Encaixes | Sugestões priorizam a borda dos menores intervalos disponíveis |
| Serviços | Grupo/variação, processamento/finalização e snapshots por atendimento |
| Recursos | Cadastro de cada sala/equipamento, vínculo ao serviço, exclusão concorrente no banco, liberação por cancelamento |
| Cuidados | Anotações imutáveis e fotos privadas normalizadas por visita; dono/gerente e profissional do atendimento |
| Beneficiário | Pessoas vinculadas ao titular, reserva com nome separado e preservação do snapshot |
| Indicadores | Próximas ações em dashboard/relatórios; vencimento e saldo de sessões em pacotes; acesso à visita pelo CRM |
| Validação | PostgreSQL, RLS sem bypass, jornadas com dependente/fila/recurso/foto e varredura desktop/mobile de 18 áreas |

Limites explícitos desta versão: etapas ocupam o profissional durante toda a
duração; cada serviço pode exigir um recurso físico exclusivo, com capacidade
representada por unidades cadastradas separadamente. Fila flexível é por
profissional e titular, com confirmação manual. Séries exibem resultados por
ocorrência, sem prometer atomicidade do lote. Fotos de até 800 KB são normalizadas
e ficam privadas no banco; nenhuma imagem de cuidado entra no bucket público.

### Direção visual solicitada com referências Fresha

Atualização posterior: o responsável autorizou lilás/roxo nas seleções e foco
do tema claro, monograma EF no topo, menu recolhível e calendário lateral.
Detalhes em `docs/NAVEGACAO_CALENDARIO_2026-09-06.md`. Esta direção substitui a
restrição de cor da primeira proposta descrita abaixo.

- Ajuste solicitado posteriormente: ações de confirmar/iniciar/concluir usam
  verde #126949; marcar falta usa vermelho #B91C1C, ambos com texto branco e
  contraste superior a 6:1. “No-show” foi traduzido para “Não compareceu”/“Faltas”
  nas telas da operação. Chegada usa destaque verde. A decisão mantém os neutros
  da marca como superfícies e devolve cor às ações operacionais.
- Cartões de Hoje distribuem ações em uma linha própria abaixo de 1536 px,
  evitando comprimir nomes e quebrar horários em telas de 1280 px.

- Entrada de marca com o logo real Everflair e luzes difusas em grafite,
  marfim, cobre e pedra. Sem importar roxo/rosa/azul da referência.
- Animação decorativa de 1,4 s, uma vez por sessão, dispensada com teclado/toque;
  não aparece com movimento reduzido e não condiciona autenticação ou carregamento.
- Agenda diária usa a foto cadastrada do profissional, recorte circular 44 px,
  nome abaixo e fallback com iniciais quando a foto está ausente ou falha.
- Tema claro usa variações de marfim e pedra, ações em grafite e cobre como
  destaque de marca. Status conservam sua semântica de informação/alerta/erro.
- A inspeção autenticada usa dados fictícios no PostgreSQL descartável do GitHub,
  conforme autorização do responsável. O Codespace não foi alterado.

### Checklist das 12 frentes

Os itens 2–11 da lista anterior foram implementados entre 018 e 019. A tabela
acima descreve o comportamento entregue e os limites, sem tratar campos ou telas
isolados como homologação. A revisão visual e as jornadas dos itens 1 e 12 estão
no CI; correções encontradas entram no mesmo PR.

- Recursos físicos: mover uma visita preserva a alocação original mesmo após
  alteração no catálogo. Trocar serviços desativa a alocação antiga sem apagar
  o registro; mudanças posteriores não voltam a ocupar o recurso aposentado.
- Fila flexível: a equipe vê o preço calculado para a data antes de confirmar;
  se o preço mudar entre revisão e gravação, a operação exige nova revisão.
- Dependentes e pedidos de fila reutilizam a chave em tentativas do mesmo
  formulário, evitando duplicação por falha de rede.
- Comparativo de temas, ícones, contrastes e distribuição: 18 áreas do
  estabelecimento em desktop claro e celular escuro, com capturas e axe.

O run `34071775481` (`87f4ccb`) passou integralmente: 40 verificações autenticadas,
incluindo as 36 revisões visuais/acessíveis das 18 áreas. Não houve erro de runtime,
overflow da página nem violação nas regras axe executadas. Os testes públicos
somaram 31 aprovados e 2 ignorados; os 7 testes PostgreSQL específicos da 019 e as
demais verificações de banco passaram. Capturas estão no artefato `browser-evidence`.
Refinamentos posteriores de leitura móvel são validados nos checks da versão
corrente do PR. Publicação produtiva é uma etapa separada, sem autorização.
## Validação

- `npm run lint`: passou.
- `npx tsc --noEmit --incremental false`: passou.
- `npm test`: 144 arquivos e 687 testes passaram.
- `npm run build`: passou, 46 páginas geradas, usando apenas URLs locais fictícias.

O run GitHub Actions `34060782156` (`b78aa88`) passou integralmente: PostgreSQL,
três jornadas autenticadas, páginas públicas em três motores e rollback sem
apagar dados. Capturas desktop/mobile em `browser-evidence`. A captura clara
passou a aguardar o fim da transição de cores. Esta máquina não tem PostgreSQL/
Docker; o teste usou apenas o banco descartável do job. O acesso a Codespaces
pelo gh exige escopo indisponível; o navegador também não dispõe da conta da
demonstração autenticada. Não houve alteração no Codespace nem em produção.

## Rollout

Revisão em PR e CI antes de qualquer promoção. Nenhum deploy produtivo autorizado
por este documento. Mudanças de banco futuras têm preflight, testes e rollback
próprios; não reaplicar migrations antigas.
