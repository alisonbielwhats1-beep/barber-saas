const labels: Record<string, string> = {
  Professional: "Profissionais", Service: "Serviços", ClientProfile: "Clientes", Appointment: "Agendamentos",
  BillingSubscription: "Assinaturas", hq_accounts: "Cadastro comercial no HQ", Membership: "Membros da equipe",
  SalonPlanGrant: "Histórico de cortesias", Product: "Produtos", ProductSale: "Vendas de produtos",
  AppointmentProduct: "Produtos em atendimentos", PortfolioItem: "Portfólio", Expense: "Despesas",
  ProfessionalOpening: "Expedientes adicionais", Package: "Pacotes", MembershipPlan: "Planos de clientes",
  UserInvite: "Convites", WaitlistEntry: "Fila de espera", SalonClosure: "Fechamentos",
  AuditLog: "Registros de auditoria", AppointmentService: "Serviços em atendimentos", AppointmentEvent: "Histórico de atendimentos",
  NotificationOutbox: "Notificações", PlatformInvoice: "Cobranças", ClientReview: "Avaliações",
  ServicePricingRule: "Regras de preço", RescheduleProposal: "Propostas de remarcação",
  PhysicalResource: "Salas e equipamentos", ResourceBooking: "Reservas de recursos", ClientDependent: "Dependentes",
  CareEntry: "Cuidados dos clientes", FlexibleWaitlist: "Fila flexível", FlexibleWaitlistService: "Serviços na fila flexível",
  ClientPushSubscription: "Dispositivos de clientes",
  SecretaryCreditLedger: "Histórico de créditos da Secretária", SecretaryCreditPurchase: "Compras de créditos da Secretária",
};
export function removalBlockerLabel(blocker: { table: string; count: number }) {
  if (blocker.count < 0) return "Um vínculo adicional precisa de revisão técnica. Nenhum dado será apagado.";
  return `${labels[blocker.table] ?? "Dados vinculados"}: ${blocker.count}`;
}
