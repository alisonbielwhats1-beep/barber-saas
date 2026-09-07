# Ícone de instalação Everflair

Solicitação: usar o símbolo da plataforma, sem iniciais do estabelecimento,
com fundo escuro e símbolo lilás ou branco. Escolha implementada: grafite
`#131315` com símbolo Flair `#C7B4E5`, derivado da marca 3 já aprovada.

## Implementação

- `scripts/generate-pwa-icons.ts` regenera PNGs 180/192/512 e SVGs a partir
  da máscara da marca aprovada, com fundo opaco e margem segura de recorte.
- `src/lib/pwa-icons.ts` centraliza URLs versionadas `flair-dark-1`, fundo,
  ícone Apple e favicon. `public/sw.js` atualiza o cache para v5.
- Manifestos raiz e por estabelecimento usam os mesmos ícones e fundo
  grafite. Layout do cliente declara também o ícone Apple explicitamente.
- Nome, id, escopo e destino do atalho de cada estabelecimento permanecem
  próprios: instalar um salão continua abrindo a jornada desse salão.
- Nenhuma alteração de banco, configuração produtiva ou dependência.

## Validação e publicação

PNG íntegro, opaco e quadrado; marca visível dentro do círculo seguro de
40% da largura. Testes de manifesto preservam o destino por tenant.
E2E verifica os links Apple no HTML raiz e cliente, downloads PNG e manifesto.
Lint, TypeScript, Vitest, build e CI são registrados por commit no PR #80.

O responsável autorizou merge e deploy desta entrega. Publicação pela
integração Git da Vercel após checks e Preview; conferência somente leitura
de home, login, jornada pública, manifesto/ícones e logs. Rollback de aplicação:
restaurar o deployment anterior, preservando o banco e seus históricos.

Esta entrega atualiza a instalação web/PWA em iPhone e Android. Não existe
pacote Android/TWA ou configuração de Play Console neste repositório; publicar
na Play Store é uma distribuição separada, não realizada por um deploy web.
Instalação física não pode ser validada neste ambiente. Atalhos já instalados
podem conservar o ícone antigo; se isso ocorrer, removê-los e adicioná-los
novamente permite buscar os metadados novos, sem excluir a conta no servidor.

Referências oficiais: [instalação PWA](https://web.dev/learn/pwa/installation),
[manifesto e ícones](https://web.dev/learn/pwa/web-app-manifest) e
[integração Android/TWA](https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide).
