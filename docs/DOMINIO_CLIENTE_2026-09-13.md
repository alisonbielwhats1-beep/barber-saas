# Domínio oficial de divulgação — 13/09/2026

Pedido: manter os links/QR Codes antigos funcionando e gerar os próximos
com o domínio oficial. Publicação autorizada pelo responsável nesta tarefa.

## Diagnóstico

- Projeto Vercel `salon-saas`, id `prj_qBERQKNhW0BjEsMaJHuft66TMYiy`.
- `everflair.com.br` e `salon-saas-ruby.vercel.app`: configuração válida,
  associados a Production. `www.everflair.com.br` redireciona 308 para o apex.
- GET da home e `/book/studio-martinelli`: 200 nos dois domínios.
- O endpoint público de providers ainda aponta o login administrativo para
  o domínio antigo. Compartilhar e Marketing usavam essa configuração.

## Alteração e compatibilidade

`PUBLIC_BOOKING_URL=https://everflair.com.br`, somente em Production, define
a origem dos novos links, QR Codes e mensagens de divulgação. Ausente/vazia,
preserva os fallbacks anteriores. Origens inválidas são recusadas.
O mesmo helper atende Compartilhar e Marketing. A UI já deriva QR, download,
copiar link e mensagens da prop `bookingUrl`.

Não alterar NEXTAUTH_URL, secrets, cookies, DNS ou associação do domínio
antigo. O manifesto PWA usa caminhos relativos: instalações antigas continuam
no domínio antigo; novas instalações começam no domínio por onde são abertas.
Sessões são por origem: quem abrir o novo domínio pode precisar entrar de novo,
com a mesma conta. Nenhum cadastro, agendamento ou histórico é migrado/apagado.

## Verificação e publicação

- Regressão de prioridade do domínio oficial e fallback local/legado.
- Lint, TypeScript, suíte Vitest e build local sem secrets produtivos.
- CI com PostgreSQL descartável e Preview protegido antes de integrar o PR.
- Configurar a nova variável antes do build produtivo da branch master.
- Após publicar, GET de home, vitrine, manifesto e login nos dois domínios,
  conferir Compartilhar se houver sessão existente e logs de runtime.
- Evidências finais de checks, commit e deploy serão registradas no PR.

## Recuperação

Reverter o PR/promover o deployment anterior retorna a geração do link antigo.
A nova variável é inerte no código anterior. Nenhuma alteração de banco ou
DNS precisa ser revertida. Manter os dois domínios em Production.
