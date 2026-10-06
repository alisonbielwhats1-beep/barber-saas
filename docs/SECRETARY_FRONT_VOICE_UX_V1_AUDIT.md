# Front/Voice V1 — auditoria anterior à implementação

25/09/2026, branch `codex/secretary-front-voice-ux-v1`. Inspeção local de código;
nenhuma observação de produção. Gates anteriores preservados. A instrução
atual autoriza implementar o plano antes registrado como PLANNED_ONLY.

## Arquitetura encontrada

- App Router: `(admin)/layout.tsx` autentica via `getTenantContext`, aplica
  ThemeProvider, sidebar, cabeçalho mobile, MobileNav e área principal rolável.
- Tokens semânticos, Button/Input, Radix Dialog, toast e lucide existentes.
  Tema claro/escuro e variáveis de safe area/visual viewport já compartilhados.
- Agenda: página servidor + AgendaBoard derivado das props; seleção/detalhe
  local, atualizações via `router.refresh()`. Serviços/Produtos/Clientes seguem
  páginas servidor e catálogos derivados de props. Financeiro é servidor,
  sem mutation financeira da Secretária neste escopo.
- `/servicos/secretaria`: chat local isolado. Server Actions obtêm tenant/actor
  da sessão, nunca do cliente; guards limitam a banco descartável local.
- `salonSecretary`: singleton local, sessões em memória. API validada de grupos
  existe na classe, ainda não exposta pelas Server Actions. Legacy usa proposal
  e revisão; V2 usa plan_ref/revision/group_key/fingerprint, já validados.
- Autoridades de domínio/journal/receipt são compartilhadas com o produto.
  `revalidatePath` já existe no transporte legacy, mas falta refresh explícito
  da página atual e confirmação V2. Sem necessidade de novo executor.
- Não há STT/TTS existente. Browser Web Speech é adapter de entrada/saída;
  texto e transcrição terão o mesmo envio autenticado. Sem novo serviço pago.

## Achados e decisões

| ID | Evidência e impacto | Correção/aceite | Severidade |
| --- | --- | --- | --- |
| F01 | Chat só em Serviços; navegação desmonta conversa | Shell no layout persistente, fecha sem perder estado | P1 |
| F02 | Candidatos/resultados exibem IDs brutos | Cards humanos, campos permitidos e links contextuais; nenhum ID renderizado | P1 |
| F03 | Transporte não chama confirmação V2 | Server Action fina para o método existente; nunca confirmar filhos de plano | P1 |
| F04 | Estado visual depende de texto/proposal, sem estados de voz | Estados explícitos, transcript editável, confirmação sempre manual | P1 |
| F05 | Correção só esconde proposta ao enviar | Desabilitar ao editar/gravar; reabilitar apenas nova resposta válida | P1 |
| F06 | Tela ativa não solicita refresh após receipt | Invalidar rotas reais + refresh após sucesso/partial com receipts | P1 |
| F07 | Erro de transporte não distingue confirmação incerta | Preservar chave; recuperação pelo mesmo contrato idempotente, sem sucesso fictício | P1 |

Manter: shell administrativo, tokens, catálogos, agenda, permissões e cérebro.
Nenhuma regra de domínio/RLS alterada por preferência visual. Sem design novo
para as cinco áreas. Desktop deve reservar largura ao painel; mobile deve
gerenciar foco, Escape, teclado e safe areas. Viewports ainda não testados
nesta auditoria: 320–430, tablet 768/1024, desktop 1280–1920.

## Implementação e validação autorizadas

Shell → texto/clarificação → cards → confirmação/receipt → cache → voz/TTS
→ mobile/acessibilidade/erros. Testes de componentes e Playwright no mesmo
Next local com login real e fixtures novas do PostgreSQL aprovado. Modelo
scriptado só no harness local, sem chamadas Luna pagas. Nunca simular backend
de sucesso. STT sintético comprova integração, não precisão de reconhecimento
nem microfone físico; qualquer lacuna será explicitada no veredito.

Fonte de compatibilidade de voz:
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService
