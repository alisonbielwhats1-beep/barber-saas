# Agenda e identificação de clientes — 12/09/2026

Ampliação do PR #98, ainda sem publicação autorizada. A imagem do Booksy é
referência funcional: régua com horas e minutos 15/30/45, e faixa de domingo a
sábado acima da agenda diária. A data selecionada determina a semana; o exemplo
12/09/2026 exibe 6 a 12. Clicar no dia atualiza a agenda mantendo seus filtros.
As visões diária e semanal recebem marcações a cada quinze minutos, preservando
a escala temporal, as reservas e os controles de criação existentes.

Possíveis duplicatas identificam conta criada ou ausência de conta no perfil
aberto, no candidato e na confirmação. Nomes/e-mails e o destino da mesclagem
ficam explícitos; quando apenas um perfil tem conta, a interface recomenda
mantê-lo. Coincidência de telefone não autoriza mesclagem automática. As regras
de servidor e a recusa de mesclar duas contas permanecem.

A consulta da agenda não filtrava `mergedIntoId` e não aplicava a exclusão da
lista. Agora aplica ambos no servidor, dentro de `withTenant`, antes do limite
de resultados. Mantém a restrição de clientes por profissional. Exclusão,
restauração e mesclagem invalidam também a agenda. Isto amplia a preferência
de lista descrita em RESPONSIVIDADE_E_LISTA_2026-09-12.md: o cliente excluído
some também do seletor manual, mas continua podendo acessar e agendar pelo app.

Sem migration, mudança de senha, apagamento de perfil ou escrita em Production.
Teste de navegador usa três perfis sintéticos: mescla o manual na conta,
exclui outro pela interface, verifica os dois ausentes no seletor e preservação
da senha da conta. Confere a semana 6–12 e régua em 320/390/1440px. Resultados
dos comandos obrigatórios, CI e Preview serão registrados no PR final.

Validação local: lint, TypeScript, 885 testes e build aprovados. Jornada nova
passou em Chromium com mesclagem/exclusão reais no banco sintético e capturas
em 320/390/1440px. A revisão das abreviações dos dias passou no navegador;
CI completo e Preview finais serão registrados no PR.
