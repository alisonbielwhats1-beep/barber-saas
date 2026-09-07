# Agenda — identidade de cor por profissional

O responsável identificou que todos os cartões pareciam laranja. A causa era
o uso de STATUS.color no fundo e na borda: atendimentos com o mesmo status
recebiam a mesma cor, independentemente do profissional.

## Comportamento

- Fundo e faixa lateral identificam o profissional nas visões dia, semana,
  mês e lista. Fotos, nomes, filtros e legenda usam a mesma identidade.
- Cores cadastradas válidas e distintas têm prioridade. Ausências, valores
  inválidos e repetições recebem cores alternativas apenas na apresentação,
  sem alterar o banco. A resolução usa a equipe completa antes dos filtros,
  com ordem determinística por ID; trocar filtro, data ou tema não redistribui
  as cores da mesma equipe.
- Superfície do cartão mistura 18% da cor com o fundo do tema. Texto mantém
  contraste; claro e escuro compartilham a identidade cromática.
- Status permanece explícito no detalhe, texto acessível, indicador e selo
  quando há espaço no cartão. Conflitos mantêm ícone e contorno vermelhos;
  bloqueios continuam hachurados. Cores dos serviços não são alteradas.
- Cartões curtos priorizam nome/serviço; horário, preço e selo aparecem conforme
  o espaço disponível, com todos os detalhes acessíveis ao abrir a reserva.

## Arquivos e verificação

`src/app/(admin)/agenda/agenda-board.tsx` e `professional-colors.ts`.
Testes em `professional-colors.test.ts` cobrem cores cadastradas, ausentes,
duplicadas, ordem da equipe e equipes maiores. `agenda-navigation.spec.ts`
confere correspondência entre cabeçalho e cartões, paleta igual nos dois temas,
contraste e navegação. Lint, TypeScript, Vitest e build são exigidos.

Validação visual local somente com dados fictícios. CI e resultados finais por
commit no PR #80. Sem mudança de banco ou deploy em produção nesta revisão.
