# Edição, término após expediente e cadastro — 11/09/2026

Base: `origin/master` `cb3babc`. Branch `codex/client-feedback-fixes`.
Escopo autorizado: corrigir os cinco pontos dos quatro áudios e imagem.
Sem migration, alteração de configuração do salão ou escrita manual produtiva.

## Diagnóstico

- O detalhe enviava os serviços originais sem oferecer seleção. A action já
  aceitava serviços, mas a proposta tratava mesmo horário como edição apenas
  de observações e poderia dispensar aceite de uma troca de serviços.
- O detalhe usava transição React para acompanhar callbacks assíncronos.
  Agora o estado acompanha a Promise inteira e um ref impede envios duplicados.
  Não foi reproduzido o travamento específico no aparelho do cliente.
- O motor rejeitava qualquer término além da jornada. O pedido é uma exceção
  pontual ao término; não é alteração do expediente nem início após fechar.
- A investigação autorizada somente leitura no projeto `barber-saas`
  (`vshnatkzxdekkvqttvbv`) encontrou o perfil reportado criado às 21h53 de
  11/09 (São Paulo), um minuto antes da imagem. Possuía senha cadastrada,
  versão de sessão zero e uma reserva posterior criada pela equipe às 22h23.
  Não havia AuditLog desse perfil. Não há evidência que identifique a pessoa
  que criou a conta, nem que prove falha de rede. A primeira tentativa ter
  persistido antes de uma repetição é uma hipótese compatível, não fato provado.
  Nenhuma senha/hash, token ou dado pessoal é reproduzido neste documento.
  A consulta de logs Vercel no intervalo 21h50–22h05 falhou com
  `ExceedsBillingLimitError`; isso não equivale à ausência de erros na aplicação.

## Comportamento

- Seleção e busca de serviços compatíveis no detalhe, até dez; permite trocar
  e adicionar. Mostra duração/término e preço base. Servidor recalcula serviços
  alterados, preços do dia e disponibilidade; snapshots intactos quando os
  serviços não mudam. Serviço histórico indisponível permanece em edições de
  horário; alterar a combinação exige remover os indisponíveis explicitamente.
- Mudança de serviços de cliente com conta também exige aceite, mesmo mantendo
  o início. A UI confirma que a proposta foi enviada; original só muda no aceite.
  Recusa, conflito ou falha preservam a reserva. Aceite usa o preço/duração
  persistidos da proposta, mesmo após alteração do catálogo.
- Dono/gerente podem confirmar criação ou edição que termine após o último
  turno, com motivo de 3–200 caracteres. O início precisa estar dentro desse
  último turno, e o término deve permanecer no mesmo dia civil (00h exclusivo
  permitido). Não ignora fechamento explícito, dia sem jornada, pausa, TimeOff,
  buffer, recursos nem sobreposição. Exceções já existentes na criação continuam
  separadas. A disponibilidade pública e a configuração da jornada não mudam.
- Na proposta, a autorização do término é persistida no fingerprint interno
  junto do motivo e do solicitante. O aceite lê essa autorização no servidor,
  nunca do payload do cliente, revalida disponibilidade e registra auditoria.
- Repetir cadastro de conta existente com senha correta executa o login normal,
  com os mesmos limitadores por conta/IP/tenant, sem recriar ou alterar o perfil.
  Corrida na constraint única segue a mesma autenticação. Senha incorreta não
  dá acesso; perfil convidado e telefone coincidente não são reivindicados.
- Cadastro bloqueia reenvios concorrentes; falha de sessão após persistência
  explica que a conta foi criada. Nova criação registra `CLIENT_ACCOUNT_REGISTERED`
  na mesma transação, sem senha, token ou IP. Login aceita caixa legada do e-mail
  de forma consistente com a busca de duplicatas.
- Recuperação por e-mail continua dependente do remetente já previsto pelo
  produto; esta entrega não habilita Resend nem envia mensagens a ninguém.

## Verificação e publicação

Regressões DOM: edição, troca/adição, duração, pending real, retry e chave após
alteração, confirmação de término, cadastro repetido e campos preservados.
Regressões de servidor: senha, constraint concorrente, tenant, papéis, bloqueios
independentes, limites de turno e restrição pública.
PostgreSQL descartável: aceite de mudança de serviços com término excepcional,
snapshots de preço/duração, idempotência, jornada preservada e auditoria.
Playwright: criação/edição reais em 390px, inspeção de edição em 320/390/1440px,
axe e screenshots sintéticas; cadastro repetido sem cookie e senha inválida.

Localmente, lint, TypeScript, 176 arquivos/875 testes Vitest e build passaram.
Resultados finais de CI e Preview serão
registrados no PR. Publicação produtiva depende da aprovação da entrega.
Rollback de código: promover a versão anterior; manter eventos e auditorias.
Não apagar nem alterar contas reais para contornar o problema de acesso.
