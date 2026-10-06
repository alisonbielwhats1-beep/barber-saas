# Secretária — início da Candidata 5 (prompt de retomada)

Use este texto numa conversa nova, aberta no PC dentro do worktree
`D:\Projetos\barber-saas\.claude\worktrees\secretary-mobile-investigation-8658bb`
(branch `claude/secretary-mobile-investigation-8658bb`; PR em rascunho #132, não mergear).

```text
Antes de agir, leia integralmente, nesta ordem:
1. docs/SECRETARY_C4_PROOF_RESULT.md (resultado da prova da Candidata 4 e plano aprovado da Candidata 5, seção 6);
2. .demo/agenda-core/AGENT_RULES.md;
3. docs/DECISOES_PRODUTO.md (última seção: decisões do dono de 29/09, regras 1 a 9);
4. docs/SECRETARY_HOLDOUT_PROTOCOL.md (a partir de "Holdout do dono (v2)");
5. docs/SECRETARY_RELEASE_CHECKLIST.md (seção 8, piloto na conta demo).

Objetivo: começar a Candidata 5 seguindo o plano da seção 6:
- Etapa 1 (segurança primeiro): corrigir as 4 escritas erradas reais da prova (combo somado ao
  próprio componente em OV09/OV43; bloqueio por cima de atendimento ignorando exceção em OV45/OV60),
  verificar o OV40 e adicionar o "conferente" (checagem da proposta contra o pedido antes de mostrar).
- Depois, preparar o spike da arquitetura "a IA entende, o backend confere" (ferramentas de consulta
  só leitura para a Luna, saída resolvida, backend só valida), medindo C4 × spike antes de adotar.

Regras: gpt-6-luna, sem fine-tuning; correções estruturais, nunca por frase; não alterar gabaritos
para fabricar PASS; nunca dois executores de teste ao mesmo tempo (hora de São Paulo via node Intl);
Production só com autorização explícita a cada passo; nunca pedir/registrar senhas ou chaves;
holdout do dono v2 já usado (vira material DEV; próxima prova exige frases novas do dono);
teto real de testes US$ 15 (≈ US$ 6,25 gastos), reportar gasto a cada rodada paga; workflows com
muitos agentes só depois de 03/10 às 15h.

Comece confirmando em poucas linhas o estado (branch, candidata congelada 35bbe35f00a4d525, gasto)
e apresente o plano da Etapa 1 antes de alterar código.
```

Candidata congelada da prova: `35bbe35f00a4d525`, com conteúdo idêntico ao de `3bba4e1f83c88b61` e `fbd27f044162d0ae`.
