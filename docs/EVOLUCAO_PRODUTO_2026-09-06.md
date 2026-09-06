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

1. Revisão visual completa de cores, ícones, componentes, espaços e estados em
   todas as telas, com evidências desktop/mobile após estas alterações.
2. Seleção por gesto na grade,
   recorrência de bloqueios e exibição nas visões semana/mês/lista.
3. Liberação de expediente por data e edição de séries futuras com conflitos.
4. Lista de espera flexível por datas/horários preservando FIFO.
5. Encaixes sugeridos por aproveitamento da disponibilidade.
6. Chegada presencial e tempo de espera com persistência própria.
7. Variantes de serviços e etapas de execução/processamento/finalização.
8. Salas/equipamentos com controle concorrente de capacidade.
9. Histórico de cuidados e fotos por visita, com armazenamento e autorização.
10. Dependentes e reservas para terceiros sem confundir titular/beneficiário.
11. Demais indicadores acionáveis, evolução contextual de CRM/pacotes/relatórios.
12. Validação autenticada integral do cliente, operação mobile e acessibilidade.

Os itens de domínio precisam de migrations aditivas, contrato de autorização,
testes PostgreSQL e homologação; não serão simulados com campos genéricos ou
habilitados em produção sem validação. Nenhuma migration foi executada.

## Validação

- `npm run lint`: passou.
- `npx tsc --noEmit --incremental false`: passou.
- `npm test`: 137 arquivos e 670 testes passaram.
- `npm run build`: passou, 46 páginas geradas, usando apenas URLs locais fictícias.

Integração PostgreSQL e inspeção visual das novas telas
ainda precisam de ambiente seguro. Esta máquina não tem PostgreSQL/Docker.
O acesso a Codespaces pelo gh exige escopo indisponível na sessão atual.

## Rollout

Revisão em PR e CI antes de qualquer promoção. Nenhum deploy produtivo autorizado
por este documento. Mudanças de banco futuras têm preflight, testes e rollback
próprios; não reaplicar migrations antigas.
