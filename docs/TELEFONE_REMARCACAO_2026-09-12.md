# Telefone, cores e remarcação — 12/09/2026

Ampliação autorizada do PR #98, sem publicação ainda. Agenda diária, semanal
e mensal usa preenchimento mais visível com a cor estável do profissional,
texto escuro contrastante e status separado. Mantém a regra de cor por pessoa.

Cadastro público exige telefone válido com DDD no formulário e no servidor.
Contas existentes sem número recebem alerta no aplicativo, sem revogação do
acesso. O preenchimento usa sessão assinada resolvida no tenant e atualiza
somente seu perfil canônico, com auditoria. Não vincula outro cadastro por
coincidência de telefone nem envia WhatsApp. Salvar invalida as telas do cliente,
CRM e agenda; CRM aberto consulta atualizações a cada 15 segundos e ao retornar
à aba. Não se afirma atualização instantânea via socket.

Relato: remarcações sucessivas no domingo parecem sobrescrever horários.
Inspeção encontrou consulta pública incluindo a própria reserva como ocupação,
mesmo em remarcação. Agora a consulta recebe a reserva, valida sessão, tenant e
propriedade e exclui somente essa reserva e sua alocação de recurso. Sem sessão
ou com reserva alheia, a consulta não permite a exclusão. A gravação continua
revalidando conflitos e versão sob lock, atualizando o mesmo ID; não cria uma
reserva cancelada paralela. Sucesso atualiza também o cache de navegação.

Teste PostgreSQL passou para domingo 12h → 10h30 → 9h30, com tentativa recusada
de sobrepor reserva vizinha das 11h. As duas vagas liberadas puderam receber
outros clientes; a reserva vizinha permaneceu idêntica e o cliente manteve uma
única reserva. Isso não comprova sobrescrita produtiva: a falha identificada
é de disponibilidade exibida. Nenhum registro real foi alterado para testar.

Regressões: telefone vazio/validação, sessão canônica, exclusão autorizada na
disponibilidade, jornadas sintéticas de completar telefone e repetir remarcação.
Sem migration ou SQL manual em Production. CI e Preview finais no PR.

Verificação local: lint, TypeScript, 890 testes em 179 arquivos e build aprovados.
Integração PostgreSQL e jornada de telefone/remarcações em Chromium passaram.
Contraste da grade validado com axe em 390/1440px. Régua lateral permanece
visível durante a rolagem horizontal. O CI anterior 34676357950 falhou em
um timeout do servidor dev na jornada de preço variável; a nova execução
usa heap explícito de 4096MB no servidor das jornadas autenticadas. Isso
não substitui aguardar o novo CI integral nem validação em aparelho físico.

O CI f2e431f confirmou as novas jornadas de telefone e remarcação, mas falhou em uma asserção antiga de altura da agenda e navegações com reinício do servidor dev por memória. A revisão visual agora inclui a faixa semanal (limitada a 70px) no espaço útil, preservando o limite inferior e demais verificações; passou localmente em claro/escuro. Jornadas e auditoria visual usam servidores novos separados, sem retirar testes. As transições para Minhas reservas aguardam a URL antes de validar o conteúdo. O resultado integral da revisão seguinte fica registrado no PR.
