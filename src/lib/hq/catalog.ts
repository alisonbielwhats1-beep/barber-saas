/** Contratos compartilhados. Os nomes SQL são constantes internas, nunca entrada HTTP. */
export type Field = {
  key: string; label: string; type: string; required?: boolean; readonly?: boolean;
  options?: readonly string[]; ref?: string; default?: number; min?: number; max?: number;
};
export type EntityDefinition = { title: string; singular: string; table: string; appendOnly?: boolean; fields: readonly Field[] };
export const definitions: Record<string, EntityDefinition> = {
  "accounts": {
    "title": "Contas",
    "singular": "Conta",
    "table": "hq_accounts",
    "fields": [
      {
        "key": "name",
        "label": "Nome",
        "type": "text",
        "required": true
      },
      {
        "key": "business",
        "label": "Estabelecimento",
        "type": "text",
        "required": true
      },
      {
        "key": "phone",
        "label": "Telefone",
        "type": "text"
      },
      {
        "key": "whatsapp",
        "label": "WhatsApp",
        "type": "text"
      },
      {
        "key": "instagram",
        "label": "Instagram",
        "type": "text"
      },
      {
        "key": "email",
        "label": "E-mail",
        "type": "email"
      },
      {
        "key": "city",
        "label": "Cidade",
        "type": "text"
      },
      {
        "key": "segment",
        "label": "Segmento",
        "type": "text"
      },
      {
        "key": "source",
        "label": "Origem",
        "type": "text"
      },
      {
        "key": "owner",
        "label": "Responsável",
        "type": "text"
      },
      {
        "key": "notes",
        "label": "Observações",
        "type": "textarea"
      },
      {
        "key": "risk",
        "label": "Risco",
        "type": "select",
        "options": [
          "Baixo",
          "Médio",
          "Alto"
        ]
      },
      {
        "key": "priority",
        "label": "Prioridade",
        "type": "select",
        "options": [
          "Baixa",
          "Média",
          "Alta",
          "Crítica"
        ]
      },
      {
        "key": "nextAction",
        "label": "Próxima ação",
        "type": "text"
      }
    ]
  },
  "leads": {
    "title": "Leads",
    "singular": "Lead",
    "table": "hq_leads",
    "fields": [
      {
        "key": "accountId",
        "label": "Conta",
        "type": "relation",
        "ref": "accounts",
        "required": true
      },
      {
        "key": "interest",
        "label": "Interesse demonstrado",
        "type": "textarea"
      },
      {
        "key": "needs",
        "label": "Necessidades identificadas",
        "type": "textarea"
      },
      {
        "key": "suggestedPlan",
        "label": "Plano sugerido",
        "type": "text"
      },
      {
        "key": "quotedCents",
        "label": "Valor apresentado",
        "type": "money",
        "default": 0
      },
      {
        "key": "temperature",
        "label": "Temperatura",
        "type": "select",
        "options": [
          "Frio",
          "Morno",
          "Quente"
        ]
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "Aberto",
          "Convertido",
          "Perdido"
        ]
      }
    ]
  },
  "customers": {
    "title": "Clientes",
    "singular": "Cliente",
    "table": "hq_customers",
    "fields": [
      {
        "key": "accountId",
        "label": "Conta",
        "type": "relation",
        "ref": "accounts",
        "required": true
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "Teste",
          "Ativo",
          "Inadimplente",
          "Pausado",
          "Cancelado"
        ]
      },
      {
        "key": "startedAt",
        "label": "Data de início",
        "type": "date"
      },
      {
        "key": "paymentMethod",
        "label": "Forma de pagamento",
        "type": "text"
      },
      {
        "key": "satisfaction",
        "label": "Satisfação",
        "type": "select",
        "options": [
          "Não avaliada",
          "Satisfeito",
          "Neutro",
          "Insatisfeito"
        ]
      }
    ]
  },
  "opportunities": {
    "title": "Pipeline",
    "singular": "Oportunidade",
    "table": "hq_opportunities",
    "fields": [
      {
        "key": "accountId",
        "label": "Conta",
        "type": "relation",
        "ref": "accounts",
        "required": true
      },
      {
        "key": "title",
        "label": "Título",
        "type": "text",
        "required": true
      },
      {
        "key": "stage",
        "label": "Etapa",
        "type": "select",
        "options": [
          "Novo Lead",
          "Contatado",
          "Interessado",
          "Demonstração",
          "Teste Grátis",
          "Negociação",
          "Fechado",
          "Perdido"
        ]
      },
      {
        "key": "valueCents",
        "label": "Valor potencial",
        "type": "money",
        "default": 0
      },
      {
        "key": "probability",
        "label": "Probabilidade (%)",
        "type": "number",
        "default": 0,
        "min": 0,
        "max": 100
      },
      {
        "key": "stageChangedAt",
        "label": "Entrada na etapa",
        "type": "datetime",
        "readonly": true
      }
    ]
  },
  "subscriptions": {
    "title": "Assinaturas",
    "singular": "Assinatura",
    "table": "hq_subscriptions",
    "fields": [
      {
        "key": "customerId",
        "label": "Cliente",
        "type": "relation",
        "ref": "customers",
        "required": true
      },
      {
        "key": "plan",
        "label": "Plano",
        "type": "text",
        "required": true
      },
      {
        "key": "amountCents",
        "label": "Valor",
        "type": "money",
        "default": 0
      },
      {
        "key": "discountCents",
        "label": "Desconto",
        "type": "money",
        "default": 0
      },
      {
        "key": "interval",
        "label": "Periodicidade",
        "type": "select",
        "options": [
          "Mensal",
          "Anual"
        ]
      },
      {
        "key": "startedAt",
        "label": "Data inicial",
        "type": "date",
        "required": true
      },
      {
        "key": "nextBillingAt",
        "label": "Próxima cobrança",
        "type": "date",
        "required": true
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "Teste",
          "Ativo",
          "Inadimplente",
          "Pausado",
          "Cancelado"
        ]
      },
      {
        "key": "trialEnd",
        "label": "Fim do teste",
        "type": "date"
      },
      {
        "key": "cancelledAt",
        "label": "Cancelado em",
        "type": "datetime",
        "readonly": true
      },
      {
        "key": "provider",
        "label": "Provedor",
        "type": "text",
        "readonly": true
      },
      {
        "key": "externalId",
        "label": "Referência externa",
        "type": "text",
        "readonly": true
      }
    ]
  },
  "payments": {
    "title": "Pagamentos",
    "singular": "Pagamento",
    "table": "hq_payments",
    "fields": [
      {
        "key": "subscriptionId",
        "label": "Assinatura",
        "type": "relation",
        "ref": "subscriptions",
        "required": true
      },
      {
        "key": "reference",
        "label": "Competência (AAAA-MM)",
        "type": "month",
        "required": true
      },
      {
        "key": "dueDate",
        "label": "Vencimento",
        "type": "date",
        "required": true
      },
      {
        "key": "amountCents",
        "label": "Valor",
        "type": "money",
        "default": 0
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "Pendente",
          "Pago",
          "Cancelado"
        ]
      },
      {
        "key": "paidDate",
        "label": "Data do pagamento",
        "type": "date",
        "readonly": true
      },
      {
        "key": "method",
        "label": "Método",
        "type": "text"
      },
      {
        "key": "notes",
        "label": "Observação",
        "type": "textarea"
      },
      {
        "key": "externalId",
        "label": "Referência externa",
        "type": "text",
        "readonly": true
      }
    ]
  },
  "activities": {
    "title": "Atividades",
    "singular": "Atividade",
    "table": "hq_activities",
    "appendOnly": true,
    "fields": [
      {
        "key": "accountId",
        "label": "Conta",
        "type": "relation",
        "ref": "accounts",
        "required": true
      },
      {
        "key": "kind",
        "label": "Tipo",
        "type": "select",
        "options": [
          "WhatsApp",
          "Ligação",
          "Reunião",
          "Demonstração",
          "Follow-up",
          "Observação",
          "E-mail",
          "Mudança de status",
          "Pagamento",
          "Suporte",
          "Bug",
          "Feature Request",
          "Feedback"
        ]
      },
      {
        "key": "description",
        "label": "Descrição",
        "type": "textarea",
        "required": true
      },
      {
        "key": "actorId",
        "label": "Ator",
        "type": "text",
        "readonly": true
      },
      {
        "key": "entityType",
        "label": "Entidade",
        "type": "text",
        "readonly": true
      },
      {
        "key": "entityId",
        "label": "Referência",
        "type": "text",
        "readonly": true
      },
      {
        "key": "metadata",
        "label": "Metadados",
        "type": "json",
        "readonly": true
      }
    ]
  },
  "followups": {
    "title": "Follow-ups",
    "singular": "Follow-up",
    "table": "hq_followups",
    "fields": [
      {
        "key": "accountId",
        "label": "Conta",
        "type": "relation",
        "ref": "accounts",
        "required": true
      },
      {
        "key": "title",
        "label": "Próxima ação",
        "type": "text",
        "required": true
      },
      {
        "key": "dueAt",
        "label": "Próximo contato",
        "type": "datetime",
        "required": true
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "Pendente",
          "Concluído",
          "Cancelado"
        ]
      },
      {
        "key": "notes",
        "label": "Observação",
        "type": "textarea"
      },
      {
        "key": "owner",
        "label": "Responsável",
        "type": "text"
      },
      {
        "key": "completedAt",
        "label": "Concluído em",
        "type": "datetime",
        "readonly": true
      }
    ]
  },
  "tickets": {
    "title": "Tickets",
    "singular": "Ticket",
    "table": "hq_support_tickets",
    "fields": [
      {
        "key": "customerId",
        "label": "Cliente",
        "type": "relation",
        "ref": "customers",
        "required": true
      },
      {
        "key": "title",
        "label": "Título",
        "type": "text",
        "required": true
      },
      {
        "key": "description",
        "label": "Descrição",
        "type": "textarea",
        "required": true
      },
      {
        "key": "category",
        "label": "Categoria",
        "type": "select",
        "options": [
          "Dúvida",
          "Suporte",
          "Bug",
          "Financeiro",
          "Outro"
        ]
      },
      {
        "key": "priority",
        "label": "Prioridade",
        "type": "select",
        "options": [
          "Baixa",
          "Média",
          "Alta",
          "Crítica"
        ]
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "Aberto",
          "Em análise",
          "Aguardando cliente",
          "Resolvido",
          "Fechado"
        ]
      },
      {
        "key": "resolution",
        "label": "Resolução",
        "type": "textarea"
      },
      {
        "key": "owner",
        "label": "Responsável",
        "type": "text"
      }
    ]
  },
  "bugs": {
    "title": "Bugs",
    "singular": "Bug",
    "table": "hq_bugs",
    "fields": [
      {
        "key": "title",
        "label": "Título",
        "type": "text",
        "required": true
      },
      {
        "key": "description",
        "label": "Descrição",
        "type": "textarea",
        "required": true
      },
      {
        "key": "evidence",
        "label": "Evidências (links e detalhes)",
        "type": "textarea"
      },
      {
        "key": "priority",
        "label": "Prioridade",
        "type": "select",
        "options": [
          "Baixa",
          "Média",
          "Alta",
          "Crítica"
        ]
      },
      {
        "key": "impact",
        "label": "Impacto",
        "type": "textarea"
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "Aberto",
          "Em análise",
          "Em correção",
          "Resolvido",
          "Fechado"
        ]
      },
      {
        "key": "version",
        "label": "Versão afetada",
        "type": "text"
      },
      {
        "key": "resolution",
        "label": "Solução",
        "type": "textarea"
      },
      {
        "key": "resolvedAt",
        "label": "Data de resolução",
        "type": "datetime",
        "readonly": true
      }
    ]
  },
  "features": {
    "title": "Features",
    "singular": "Feature request",
    "table": "hq_feature_requests",
    "fields": [
      {
        "key": "title",
        "label": "Título",
        "type": "text",
        "required": true
      },
      {
        "key": "description",
        "label": "Descrição",
        "type": "textarea",
        "required": true
      },
      {
        "key": "category",
        "label": "Categoria",
        "type": "text"
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "Recebida",
          "Em análise",
          "Planejada",
          "Em desenvolvimento",
          "Entregue",
          "Descartada"
        ]
      },
      {
        "key": "priority",
        "label": "Prioridade",
        "type": "select",
        "options": [
          "Baixa",
          "Média",
          "Alta",
          "Crítica"
        ]
      },
      {
        "key": "impact",
        "label": "Impacto estimado",
        "type": "textarea"
      },
      {
        "key": "normalizedTitle",
        "label": "Título normalizado",
        "type": "text",
        "readonly": true
      }
    ]
  },
  "bugCustomers": {
    "title": "Clientes afetados",
    "singular": "Associação",
    "table": "hq_bug_customers",
    "fields": [
      {
        "key": "bugId",
        "label": "Bug",
        "type": "relation",
        "ref": "bugs",
        "required": true
      },
      {
        "key": "customerId",
        "label": "Cliente",
        "type": "relation",
        "ref": "customers",
        "required": true
      }
    ]
  },
  "featureCustomers": {
    "title": "Clientes interessados",
    "singular": "Interesse",
    "table": "hq_feature_request_customers",
    "fields": [
      {
        "key": "featureId",
        "label": "Feature",
        "type": "relation",
        "ref": "features",
        "required": true
      },
      {
        "key": "customerId",
        "label": "Cliente",
        "type": "relation",
        "ref": "customers",
        "required": true
      }
    ]
  },
  "feedbacks": {
    "title": "Feedbacks",
    "singular": "Feedback",
    "table": "hq_feedbacks",
    "fields": [
      {
        "key": "customerId",
        "label": "Cliente",
        "type": "relation",
        "ref": "customers",
        "required": true
      },
      {
        "key": "kind",
        "label": "Tipo",
        "type": "select",
        "options": [
          "Elogio",
          "Reclamação",
          "Sugestão",
          "Experiência",
          "Usabilidade"
        ]
      },
      {
        "key": "description",
        "label": "Descrição",
        "type": "textarea",
        "required": true
      },
      {
        "key": "activityId",
        "label": "Atividade",
        "type": "relation",
        "ref": "activities",
        "required": false,
        "readonly": true
      },
      {
        "key": "ticketId",
        "label": "Ticket gerado",
        "type": "relation",
        "ref": "tickets",
        "required": false,
        "readonly": true
      },
      {
        "key": "bugId",
        "label": "Bug relacionado",
        "type": "relation",
        "ref": "bugs",
        "required": false,
        "readonly": true
      },
      {
        "key": "featureId",
        "label": "Feature relacionada",
        "type": "relation",
        "ref": "features",
        "required": false,
        "readonly": true
      }
    ]
  }
};
// Source fields are visible, but cannot be submitted through manual HQ commands.
definitions.subscriptions.fields = [...definitions.subscriptions.fields,
 {key:"billingState",label:"Situação no Mercado Pago",type:"text",readonly:true},
 {key:"billingPaidThrough",label:"Acesso pago até",type:"datetime",readonly:true},
 {key:"billingAgendaLimit",label:"Agendas contratadas",type:"number",readonly:true},
];
definitions.payments.fields = [...definitions.payments.fields,
 {key:"billingStatus",label:"Situação no Mercado Pago",type:"text",readonly:true},
 {key:"billingRefundedCents",label:"Valor estornado",type:"money",readonly:true},
];
export const stages = ["Novo Lead","Contatado","Interessado","Demonstração","Teste Grátis","Negociação","Fechado","Perdido"] as const;
export type Row = { id: string; createdAt: string; updatedAt: string; [key: string]: string | number | null };
export const entityKeys = Object.keys(definitions);
export function definition(key: string): EntityDefinition {
  if (!Object.hasOwn(definitions, key)) throw new Error("Módulo inválido.");
  return definitions[key];
}
export const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
export const hqTimezone = "America/Sao_Paulo";

