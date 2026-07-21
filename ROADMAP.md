# Roadmap — Salon SaaS

Visão de produto para evolução da plataforma multi-tenant. Organizado por
persona (dono × cliente) e priorizado por impacto no negócio.

---

## Transformação premium do painel do dono — plano em fases

Objetivo: elevar o painel ao nível Stripe / Linear / Notion / Vercel.

Todas as 7 fases foram concluídas e estão em produção.

- **Fase 1 — CONCLUÍDA.** Design system semântico + Dashboard reconstruído
  (hero KPIs, stat tiles, filtro de período, gráficos, split por gênero).
  Campo `ClientProfile.gender`. Sidebar agrupada.
- **Fase 2 — CONCLUÍDA.** Agenda pro: cores por status, linha do agora,
  drag-to-move, redimensionar, visões Dia/Semana/Mês/Lista, filtros, busca,
  ações rápidas (status/WhatsApp/duplicar/recibo). Actions move/resize/duplicate.
- **Fase 3 — CONCLUÍDA.** Financeiro: modelo `Expense`, receita/despesa,
  fluxo de caixa, DRE, contas a pagar/receber, donuts categoria e forma de
  pagamento, gestão de despesas.
- **Fase 4 — CONCLUÍDA.** Catálogo: Service/Product ganharam custo, categoria,
  fornecedor, minStock, validade. Serviços e produtos como cards premium com
  margem/lucro/popularidade, filtros, ajuste de estoque, alertas de reposição.
- **Fase 5 — CONCLUÍDA.** Pacotes & Planos: modelos Package/PackagePurchase/
  MembershipPlan/ClientSubscription; venda, uso de sessão, congelar/renovar,
  assinaturas, MRR.
- **Fase 6 — CONCLUÍDA.** CRM (`src/lib/crm.ts`): LTV, fidelidade, favoritos,
  segmentação (VIP/sumido/aniversariante), drawer com histórico. Marketing:
  campanhas com WhatsApp + cupom.
- **Fase 7 — CONCLUÍDA.** Relatórios (comparativos + export CSV/PDF), command
  palette ⌘K, toasts globais, skeletons de carregamento. Campos de settings
  no Salon; página `/configuracoes` com acessos por papel.

### Próximos passos possíveis (fora do roadmap original)
- Billing do próprio SaaS (Stripe) usando o enum `Plan` FREE/STARTER/PRO.
- Ativar RLS (`prisma/migrations/rls/enable_rls.sql`) antes de clientes reais.
- Reviews/avaliações (modelo novo) para nota real dos profissionais.
- Portfolio premium e refino da landing comercial.
- Envio real de WhatsApp/SMS (Evolution API/Twilio) para lembretes e campanhas.

Cada fase que depende de dado novo exige migração de schema + seed —
lembrar das armadilhas de `DIRECT_URL`/`db push` no CLAUDE.md.

---

## 🧑‍💼 Painel do dono (admin)

### Abas existentes
Dashboard · Agenda · Serviços · Produtos · Profissionais · Clientes · Portfolio

### Abas novas propostas

#### 1. Financeiro (prioridade alta)
O dono precisa de visão total de custo. Hoje o dashboard mostra receita;
falta o outro lado da conta:
- **Custos fixos** cadastráveis (aluguel, luz, água, software, marketing)
- **Custos variáveis** automáticos: comissões (já existe `commissionPct`),
  custo de produto vendido (adicionar `costCents` em `Product`)
- **DRE simplificado**: receita − comissões − custos = lucro do mês
- **Margem por serviço**: quais serviços dão lucro de verdade
- Projeção de receita do mês com base nos agendamentos confirmados

#### 2. Configurações (página já está no menu, falta implementar)
- Dados do salão (nome, endereço, telefone, fuso horário, moeda)
- Horário de funcionamento padrão do salão
- **Gestão de acessos**: convidar/remover membros, trocar papel
  (OWNER / MANAGER / PROFESSIONAL / RECEPTIONIST) — o modelo `Membership`
  já suporta, falta a UI
- Política de cancelamento (antecedência mínima, taxa de no-show)

#### 3. Assinatura / Plano (monetização do SaaS)
- Tela de billing: plano atual (`Plan` já existe no schema: STARTER/PRO),
  limites por plano (nº de profissionais, nº de agendamentos/mês)
- Integração Stripe para cobrança recorrente
- Trial de 14 dias para novos salões

### Melhorias em abas existentes

#### Agenda (prioridade alta — pedido direto)
- **Ações de 1 clique** no agendamento: confirmar, cancelar, remarcar,
  marcar falta (no-show), concluir
- **Remarcar por arrastar** (drag-and-drop) no calendário
- **Contato imediato**: botão WhatsApp (`wa.me/55...`) em todo agendamento
  com mensagem pré-preenchida ("Olá {nome}, sobre seu horário de {data}…")
- Filtro por profissional e por status
- Visão dia / semana / mês

#### Clientes (CRM leve)
- Histórico completo por cliente: serviços, gasto total (LTV), frequência
- Tags ("VIP", "sumido há 60 dias") e notas internas
- Botão WhatsApp direto na lista
- **Campanha de resgate**: listar clientes sem visita há X dias

#### Produtos
- Alerta de estoque baixo no dashboard
- Custo de aquisição → margem por produto no Financeiro

#### Profissionais
- Página de performance individual (já existe query em `kpis.ts`)
- Gestão de folgas/férias pela UI (modelo `TimeOff` já existe)

---

## 💇 App do cliente (`/book/[salonSlug]`)

### Abas existentes
Início · Loja · Fotos · Minhas

### Melhorias propostas

#### 1. Aba Perfil (nova)
- Dados do cliente (nome, WhatsApp) salvos — sem redigitar a cada reserva
- Histórico de atendimentos com botão "repetir agendamento"
- **Fidelidade**: a cada N cortes, 1 grátis ou desconto (configurável
  pelo dono) — grande diferencial de retenção

#### 2. Minhas reservas
- **Cancelar e remarcar pelo próprio app** (respeitando a política de
  antecedência do salão) — reduz no-show e telefonema
- Botão "adicionar ao calendário" (.ics) em toda reserva futura

#### 3. Avaliações (pós-atendimento)
- Modelo novo `Review(appointmentId, rating, comment)`
- Cliente avalia após status COMPLETED
- Nota real do profissional aparece no card de agendamento
  (hoje mostramos contagem de atendimentos — com Review vira estrela real)

#### 4. Notificações
- Lembrete automático via WhatsApp (Evolution API ou Twilio) 24h e 2h antes
- Confirmação de presença pelo link ("responda SIM") → status CONFIRMED

---

## 🏢 Multi-tenant / Escalabilidade

- **Seletor de salão** no admin para donos com múltiplos salões
  (`Membership` já permite; falta o switcher na sidebar)
- **Onboarding self-service**: página de signup que cria salão + owner num
  passo (hoje o signup existe mas o fluxo de criação de salão pode ser
  polido com wizard: dados → serviços → equipe → horários)
- **Ativar RLS** (`prisma/migrations/rls/enable_rls.sql` pronto) como
  defense-in-depth antes de abrir para salões reais
- Caminho de escala já documentado no README: particionamento por
  `salonId` → réplicas de leitura → schema-per-tenant (só depois de
  ~200 salões)
- **Domínio próprio por salão** (ex.: `agenda.barbeariax.com.br`) via
  Vercel wildcard domains — recurso premium do plano PRO

---

## Ordem sugerida de execução

| # | Item | Por quê primeiro |
|---|------|------------------|
| 1 | Ações de 1 clique na Agenda + botão WhatsApp | Dor diária do dono, esforço baixo |
| 2 | Página Configurações | Já está no menu (link quebrado) |
| 3 | Cancelar/remarcar pelo cliente | Reduz no-show, reduz telefonemas |
| 4 | Aba Financeiro | Visão de custo pedida pelo produto |
| 5 | Reviews + fidelidade | Retenção e prova social real |
| 6 | Billing Stripe | Monetização — quando houver salões reais |
| 7 | RLS + seletor multi-salão | Antes de abrir para terceiros |
