# Evolução de produto — implementação em andamento

Base: origin/master a66a98b. Branch: codex/product-experience.
Este documento acompanha a solicitação de implementar as 12 frentes da auditoria.
Não representa implantação nem conclusão do programa completo.

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

## Itens ainda abertos da solicitação

### Continuação autorizada — 019 em validação

As pendências abaixo receberam implementação nesta continuação, mas a validação
remota ainda está em andamento. Não representam publicação em produção.

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
| Validação | PostgreSQL, RLS sem bypass, jornadas com dependente/fila/recurso/foto e varredura desktop/mobile de 16 áreas |

Limites explícitos desta versão: etapas ocupam o profissional durante toda a
duração; cada serviço pode exigir um recurso físico exclusivo, com capacidade
representada por unidades cadastradas separadamente. Fila flexível é por
profissional e titular, com confirmação manual. Séries exibem resultados por
ocorrência, sem prometer atomicidade do lote. Fotos de até 800 KB são normalizadas
e ficam privadas no banco; nenhuma imagem de cuidado entra no bucket público.

### Direção visual solicitada com referências Fresha

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
- Testes locais após esta etapa: lint e TypeScript aprovados; 138 arquivos,
  674 testes e build aprovados. CI da versão final acompanhado separadamente.
- Login local abriu em 200. Inspeção visual autenticada da agenda continua
  dependendo de ambiente com dados fictícios e acesso autorizado.

### Pendências do programa completo

1. Revisão visual completa de cores, ícones, componentes, espaços e estados em
   todas as telas, com evidências desktop/mobile após estas alterações.
2. Seleção por gesto na grade,
   recorrência de bloqueios e exibição nas visões semana/mês/lista.
3. Edição de séries futuras com conflitos; expediente por data implementado na 018, em validação.
4. Lista de espera flexível por datas/horários preservando FIFO.
5. Encaixes sugeridos por aproveitamento da disponibilidade.
6. Chegada presencial e tempo de espera implementados na 018, em validação.
7. Variantes de serviços e etapas de execução/processamento/finalização.
8. Salas/equipamentos com controle concorrente de capacidade.
9. Histórico de cuidados e fotos por visita, com armazenamento e autorização.
10. Dependentes e reservas para terceiros sem confundir titular/beneficiário.
11. Demais indicadores acionáveis, evolução contextual de CRM/pacotes/relatórios.
12. Validação autenticada integral do cliente, operação mobile e acessibilidade.

Os itens de domínio precisam de migrations aditivas, contrato de autorização,
testes PostgreSQL e homologação; não serão simulados com campos genéricos ou
habilitados em produção sem validação. Plano e evidências da próxima migration em
`docs/MIGRATION_018_EXPEDIENTE_CHEGADA.md`; sem execução produtiva.

## Validação

- `npm run lint`: passou.
- `npx tsc --noEmit --incremental false`: passou.
- `npm test`: 141 arquivos e 681 testes passaram.
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
