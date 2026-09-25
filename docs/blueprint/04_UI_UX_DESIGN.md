# Design UI/UX — Everflair

**Base:** `origin/master` `27255eb`, tokens em `src/app/globals.css` e decisões de aparência em [`../DECISOES_PRODUTO.md`](../DECISOES_PRODUTO.md). Este é um guia de interface, não um novo layout aprovado nem um arquivo Figma.

## Direção visual atual

| Contexto | Superfícies | Ação principal | Acentos e significado |
| --- | --- | --- | --- |
| Painel claro | Fundo cinza quase branco `#F6F7F9`, cartões brancos e grafite | Verde `#126949` | Lilás para marca/seleção; azul execução, âmbar pendência, vermelho crítico. |
| Painel escuro | Grafite em camadas, texto claro | Verde claro do tema | Mesmos estados semânticos com contraste próprio. |
| Cliente claro/escuro | Neutros do tema, entrada grafite com movimento verde/lilás | Verde | Reserva mostra status em texto/ícone; fotos de profissionais, produtos e portfólio continuam, catálogo de serviços sem fotos. |
| Landing | Marfim/grafite; planos em cards | CTA coerente com marketing | Card Equipe pode usar violeta suave aprovado; Everflair IA aparece bloqueado “Em breve”. |

Tipografia atual: Inter com fallback `system-ui`. Tokens de cor, borda, raio e tema pertencem a `src/app/globals.css`; componentes devem consumir variáveis semânticas (`--background`, `--card`, `--primary`, `--danger`, `--ring`) em vez de copiar hex em cada tela. Tema do cliente é independente do painel e deve ser restaurado antes da primeira pintura. Cor do cartão da agenda identifica o **profissional**; status tem selo/texto, e conflito recebe tratamento crítico separado.

## Hierarquia de telas

### Painel do estabelecimento

```text
Desktop: menu recolhível | título/ação da página | conteúdo principal
Agenda: data + modos Dia/Semana/Mês/Lista | grade ampla | filtros sob demanda
Mobile: cabeçalho compacto | conteúdo em lista/grade | barra inferior + ação “+”
```

- **Dashboard:** próxima ação e próximo atendimento primeiro; indicadores depois. Não misturar receita prevista, realizada e recebida em um número sem rótulo.
- **Agenda:** grade é a peça central. Mostrar jornada, pausa, bloqueio, fechamento, reserva e conflito com formas/texto distintos. O cabeçalho de profissional usa nome/foto/cor; modo “Dia inteiro” revela períodos fora da jornada.
- **Novo agendamento:** selecionar cliente → serviços/profissionais → data/horário → revisão → confirmação. Exceções (folga, pausa, encaixe, término fora do turno) pedem confirmação e motivo específicos, sem um único botão genérico de “ignorar”.
- **Financeiro:** separar pendentes do dia, recebimentos e recibos. Data do recebimento deve ser explícita; desmarcar item significa mantê-lo pendente. Não sugerir que conclusão do serviço equivale a pagamento.
- **Configuração inicial:** quatro etapas curtas (horários, serviços, profissionais, link do cliente), com progresso, adiamento e retomada. O painel oferece acesso para concluir depois.

### Aplicativo do cliente

```text
Vitrine: marca + salão | catálogo compacto | avaliação/contato | CTA Agendar
Agendar: serviços → profissional por item → data/slot → revisão → confirmar
Minhas: próxima reserva | ações possíveis | histórico/fila/notificações
```

- Mostrar preço “a partir de” quando aplicável e explicar que o valor final é conferido antes de confirmar. Duração, serviços e profissional aparecem juntos na revisão.
- Autenticação só interrompe no momento de escrever dados pessoais ou confirmar. Depois do login, devolver o cliente ao contexto de escolha válido.
- Horário indisponível tem mensagem e alternativas; falha de rede não parece “dia sem vagas”. Não manter CTA habilitado sobre resposta antiga.
- Alteração pela equipe deve mostrar o horário atual, o anterior, serviços/preço congelados e o efeito de aceitar ou recusar. Na recusa, explicar que o novo horário permanece reservado até contato da equipe.
- Em “Minhas”, destacar próxima reserva antes do histórico; nome do salão, data relativa, duração, endereço e estado são legíveis sem depender de cor.

## Componentes e estados

| Componente | Estados necessários | Comportamento |
| --- | --- | --- |
| Botão principal | disponível, carregando, desabilitado, sucesso/erro | Impedir duplo envio; rótulo indica ação concreta. |
| Slot | disponível, selecionado, indisponível, em atualização | Só confirmar slot retornado pela consulta atual. |
| Formulário | vazio, inválido, salvando, salvo, erro | Erro junto ao campo e resumo quando necessário; rascunho preservado em falha recuperável. |
| Dialog/sheet | aberto, confirmação, fechamento | Nome acessível, alvo mínimo de 44 px, foco contido e devolvido ao gatilho. |
| Toast | informação, sucesso, aviso, erro | Região viva adequada, fila sem anúncios duplicados, pausa em hover/foco. |
| Pagamento | pendente, confirmado, falhou, cancelado | Mostrar vigência e origem da confirmação; checkout iniciado não equivale a acesso pago. |

## Responsividade e acessibilidade

- Conferir 320, 390 e 1440 px; considerar teclado móvel, zoom e `safe-area-inset-*`. CTA fixo não cobre o último item nem fica sob a barra do sistema.
- Teclado opera menu, calendário, filtros, dialogs e ações; Escape devolve foco a elemento conectado. Apenas um focus trap fica aberto (palette ou menu “Mais”).
- Contraste e foco visível nos temas claro/escuro; ícone, texto e forma acompanham qualquer cor semântica. Respeitar `prefers-reduced-motion` na entrada e nas transições.
- Estados de carregamento, vazio, bloqueado por permissão e erro possuem instrução acionável. Nunca usar skeleton como substituto permanente de erro.

## Aceite visual de uma mudança futura

Uma tela só está pronta quando sua jornada principal e as saídas de erro são compreensíveis em celular e desktop, sem overflow, perda de foco, ação duplicada ou informação de tenant errado. Validar com capturas e E2E em banco sintético; a revisão visual não altera permissões de servidor.
