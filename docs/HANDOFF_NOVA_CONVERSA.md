# Handoff para outra conversa ou conta

Este documento permite continuar o Salon SaaS sem repetir uma auditoria geral.
Ele não substitui a verificação do escopo específico que será alterado.

## Como iniciar em outra conta

1. Abra ou clone o repositório:
   `https://github.com/alisonbielwhats1-beep/barber-saas`.
2. Garanta que está na branch `master` e sincronizada com `origin/master`.
3. Peça ao agente para ler, nesta ordem:
   - `AGENTS.md`;
   - `docs/STATUS_ATUAL.md`;
   - `docs/AMBIENTES.md`;
   - `docs/DECISOES_PRODUTO.md`;
   - documento da fase que será trabalhada.
4. Não forneça senhas, tokens ou arquivos `.env` na conversa.
5. Escolha uma única tarefa/fase antes de autorizar mudanças.

## Prompt recomendado

```text
Você está trabalhando no repositório do Salon SaaS:
https://github.com/alisonbielwhats1-beep/barber-saas

Antes de agir, leia integralmente AGENTS.md, docs/STATUS_ATUAL.md,
docs/AMBIENTES.md e docs/DECISOES_PRODUTO.md. Esses arquivos são o handoff
canônico e substituem conversas antigas quando houver contradição.

Não refaça uma auditoria geral. Faça somente uma confirmação curta de branch,
CI, ambiente e arquivos relacionados à tarefa. Não use nem altere Production,
não execute db push/seed/reset e não reaplique SQL manual. Preserve RLS,
isolamento multi-tenant, dados, histórico e padrões existentes.

A versão produtiva documentada é daf54a6. A migration 011 de billing está
versionada, mas não aplicada; PLATFORM_BILLING_ENABLED está desligada.

Minha tarefa nesta conversa é: [DESCREVA UMA ÚNICA TAREFA AQUI].

Apresente o diagnóstico específico e o plano curto; implemente apenas depois
de confirmar que não há risco de ambiente ou expansão indevida de escopo.
```

## Verificação curta permitida

O novo agente pode confirmar, sem repetir a auditoria:

```bash
git status -sb
git log -1 --oneline
npm ci
npm run lint
npx tsc --noEmit --incremental false
npm test
```

O build usa variáveis locais fictícias ou um `.env` de desenvolvimento. Nunca
deve usar secrets produtivos só para compilar.

## O que não pedir ao novo agente

- “Aplique todas as migrations” sem identificar o banco e o estado atual.
- “Conserte tudo” ou “reescreva o sistema”.
- Enviar senha de banco, Supabase, Vercel ou conta administrativa no chat.
- Desligar RLS para resolver erro de permissão.
- Criar integração paga sem decisão comercial.
- Testar em dados reais de clientes.

## Pontos que exigem nova decisão do responsável

- preço e regras dos planos FREE/PRO;
- vencimento, inadimplência, trial e cobrança automática;
- taxa de cancelamento/no-show, estorno, comissão e cupom;
- contratação de Resend, WhatsApp, SMS ou gateway de pagamento;
- criação do segundo Supabase para staging;
- momento de ativar a migration `011` e o billing manual;
- política de múltiplas unidades e compartilhamento de profissionais.

## Resultado esperado do primeiro turno

O novo agente deve responder com:

- versão/branch encontrada;
- confirmação de que leu os quatro documentos;
- escopo específico entendido;
- riscos somente daquela tarefa;
- plano curto;
- nenhuma alteração produtiva sem autorização explícita.
