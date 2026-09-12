# Transferência do orquestrador Everflair

Snapshot dos arquivos locais solicitados, preparado em 12/09/2026 para continuar
o trabalho em outro computador. Esta branch é um pacote de transferência, não
uma versão completa do aplicativo nem uma branch para merge direto em produção.

## Usar no outro PC

1. Baixe esta branch do GitHub (Code → Download ZIP).
2. Abra o checkout completo de `alisonbielwhats1-beep/barber-saas` no outro PC.
3. Preserve alterações locais e compare os arquivos antes de aplicar.
4. Copie o conteúdo de `app/` desta pasta para a raiz da aplicação Next.js
   existente, preservando os caminhos relativos. Não crie uma segunda pasta
   `app` dentro da aplicação por engano.
5. Confira os dois `package.json` e o lockfile juntos, então execute `npm ci`
   e as verificações documentadas em `app/docs/HQ_ORQUESTRADOR_AGENTS_API.md`.

`manifest.json` lista os 14 arquivos com SHA-256, conferidos contra os originais.
Os originais foram mantidos no computador anterior.

## Estado do trabalho

O código transferido implementa Triage → Product quando necessário → Chief.
A solicitação mais recente autoriza ampliar para Sales, Customer Success,
Operations e Marketing também, selecionando o especialista pelo Triage e
consolidando a resposta em Chief. Essa ampliação ainda não está implementada.

Não há servidor de teste preparado nem chamada real deste orquestrador validada.
É necessário iniciar o aplicativo com banco isolado, autenticação administrativa
e chave OpenAI no servidor. Não conectar WhatsApp nem testar em Production.

Lint, TypeScript e 42 testes específicos passaram no PC anterior. A suíte geral
e o build completo não foram aprovados naquela rodada; detalhes no documento.

## Dependências e escopo da cópia

Os manifests foram copiados integralmente como solicitado e incluem mudanças
locais preexistentes, como a dependência Twilio e o export `./whatsapp` no pacote
de agentes. O módulo desse export pertence ao trabalho anterior de WhatsApp e
não faz parte desta transferência. Não ative esse caminho; compare os manifests
com o checkout de destino antes de integrá-los. Esta pasta contém somente o
snapshot solicitado, não todos os arquivos do repositório ou alterações locais.

Somente `.env.example` foi incluído: contém valores de exemplo e campos vazios,
sem chaves reais. Não foram copiados `.env`, `.env.local`, configurações privadas,
tokens, credenciais, banco, logs, `.git`, `node_modules` ou `.next` da aplicação.
Os IDs de projeto/agente não são credenciais.
