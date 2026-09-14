# Experiência mobile guiada — 14/09/2026

## Escopo e diagnóstico

Pedido autorizado: aplicar padrões mobile-first, divulgação progressiva,
busca em listas longas, bottom sheets e tutorial contextual inspirado nas imagens
fornecidas. Não inclui deploy produtivo nem reconstrução de todas as telas.

Antes: o guia montava um formulário completo para cada serviço; a visita usava
selects nativos extensos, horário vazio com regra implícita e erro de disponibilidade
genérico. Arraste na agenda é explicitamente desativado para pointerType touch.

## Direção e implementação

As habilidades frontend-design e UI/UX Pro Max orientam hierarquia, alvos de toque,
foco, redução de movimento e escolhas sob demanda. Identidade existente preservada:
grafite/cinza-claro, verde de ação, lilás de seleção, fonte e ícones atuais.
A assinatura visual é a pequena agenda demonstrativa animada sobre fundo escurecido,
com sombra; não copia marca ou ativos do Fresha.

- Serviços: busca insensível a acentos, filtros Todos/A revisar, resumo compacto,
  lista com altura limitada, continuar acessível e somente um editor aberto.
  Falha preserva preenchimento e aparece dentro do editor; descarte exige escolha.
- Visita: cliente/início → serviços → revisão. Escolhas pesquisáveis e painéis
  inferiores no celular, diálogos no desktop; preços/revisão continuam no servidor.
- Data e início obrigatórios. Cada item mostra início/término calculados; edição
  explícita exige horário válido e permite retorno à sequência. Não confunde
  campo vazio com meia-noite nem oculta passagem para outro dia.
- Erros usam o mesmo motor que decide disponibilidade e identificam serviço,
  profissional e motivo: expediente, folga, fechamento, reserva, recurso ou oferta.
  Exceção não libera fechamento geral, disputa de reserva/recurso nem isolamento.
- Tutorial na primeira entrada mobile por salão/usuário/navegador, com Pular,
  Voltar, Próximo, conclusão e botão de ajuda para repetir. Não interrompe links
  diretos para um atendimento. Falha de armazenamento não bloqueia a agenda.
  Ensina navegação, toque/+ para criar e detalhes/edição; não promete arraste touch.
- Diálogos seguem a viewport visual/teclado e safe areas; inputs de tempo têm
  largura limitada. Animação curta e finita, desligada com reduced-motion.

## Ambiente e verificação

Checkout isolado `D:/Projetos/barber-saas-mobile-guided`, branch
`codex/mobile-guided-experience`, base `origin/master` `a78a0b2`.
Alterações anteriores em `codex/scrollcraft-barber-saas` preservadas.
Banco local `salon_mobile_guided_20260914`, loopback `127.0.0.1:56484`:
restauração somente do schema sintético anterior, inicialmente zero usuários e
salões; fixtures fictícias novas. Migration de convites atual aplicada apenas
nessa cópia vazia. Nenhum schema, segredo ou registro produtivo copiado.

Validação local em 14/09:

- `npm run lint` e `npx tsc --noEmit --incremental false`: aprovados.
- `npm test`: 205 arquivos, 1.100 testes aprovados.
- `npx vitest run src/lib/__tests__/visits-postgres.integration.test.ts`, com
  `RUN_POSTGRES_INTEGRATION=1` no banco sintético: 10 testes aprovados.
- `npx playwright test tests/e2e/mobile-guided.spec.ts --project=chromium
  --project=webkit --workers=1`: 2 jornadas aprovadas. Inclui 90 serviços,
  edição persistida, busca sem acentos, tutorial, ambos os temas, disponibilidade
  por profissional, dois atendimentos confirmados, foco e auditorias axe.
- Jornada existente `initial-setup.spec.ts`, Chromium: aprovada.
- Jornada existente `multi-visits.spec.ts`, Chromium: aprovada, incluindo
  reservas públicas, painel, remarcação, recusa, folga e acesso profissional.
- `npm run build`: aprovado (58 páginas estáticas, rotas dinâmicas compiladas).

Jornadas preexistentes que entram na agenda mobile agora dispensam o tutorial
pelo botão real antes de prosseguir, sem retirar as asserções de acessibilidade
ou regras de negócio. Sua regressão completa continua no CI sintético.

Capturas reais dos navegadores em `.demo/mobile-evidence/{chromium,webkit}/`
(artefatos locais ignorados pelo Git). Conferidos 320×740, 390×844 e 844×390.
A inspeção visual identificou e corrigiu: ajuda atrás da grade, colisão de classe
na animação, contraste de ações, diálogo sem nome acessível e rodapé sobreposto
ao horário em paisagem. A rolagem agora é uma região separada do rodapé; o teste
confere que o campo não está encoberto e que a mensagem termina acima do botão.
O texto da exceção de jornada usa contraste normal, com borda de alerta.

CI, Preview e publicação são estados distintos; a publicação produtiva depende
de aprovação posterior. Resultados remotos serão vinculados no PR.

## Recuperação e limites

Sem migration nova. Reverter este PR restaura a interface anterior; serviços e
reservas gravados continuam compatíveis. A preferência local do tutorial é inerte
na versão anterior. Não houve alteração de flags, cobrança, e-mail ou Production.
Emulação de navegador não equivale a teste físico de teclado/gestos no iPhone.
