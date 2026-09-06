# Everflair no GitHub Codespaces

Ambiente de demonstração solicitado em 06/09/2026. Usa PostgreSQL e Redis privados dentro do Codespace; não usa nenhum projeto Supabase nem credenciais produtivas.

## Acessar

Crie um Codespace na branch codex/everflair-demo. A preparação instala as dependências, aplica o schema e as policies existentes em um banco novo, gera dados fictícios e compila o app. O aplicativo inicia na porta 3000.

- Dono: /login — email demo@everflair.example.
- Cliente: /book/everflair-demo/login — email cliente@everflair.example.
- Segunda vitrine: /book/everflair-barber-demo.
- Acesso de recepção: recepcao@everflair.example.
- Profissional: profissional@everflair.example.

Senhas aleatórias ficam apenas no arquivo privado .demo/credentials.json. Não publique esse arquivo, seu conteúdo nem segredos do banco em commits, issues, logs ou imagens da apresentação. Os endereços .example são identificadores de login, não caixas de e-mail reais.

## Compartilhar com um cliente

Após validar a aplicação, use Ports para compartilhar SOMENTE a porta 3000 como Public. Compartilhe a URL dessa porta e as credenciais de demonstração do papel desejado. O visitante usará o login do aplicativo; não precisa de conta Vercel. Não compartilhe o editor do Codespace nem encaminhe PostgreSQL/Redis.

O link funciona enquanto o Codespace estiver ligado. Ao terminar a apresentação, pare o Codespace. Não é hospedagem 24 horas. O consumo usa a cota de Codespaces da conta; não aumente orçamento nem habilite cobrança adicional automaticamente.

## Dados e limites

Os nomes, serviços, valores, avaliações e compromissos são explicitamente fictícios. Há dois estabelecimentos para validar isolamento, três profissionais por estabelecimento, clientes, agenda histórica e futura, pagamentos manuais, despesas, produtos, pacote e portfólio.

O banco persiste no volume do Codespace. Iniciar novamente não limpa nem sobrescreve dados. Para uma nova massa, crie um Codespace novo; não execute reset em um banco externo. A agenda é gerada em torno da data da preparação.

Uploads Supabase, e-mail real, WhatsApp automático, cobrança e administração global não são ativados. As imagens iniciais são arquivos do próprio repositório. O rate limit usa Redis local através de SRH, sem conta Upstash. O runtime usa app_runtime sem BYPASSRLS, com as policies versionadas do produto.

As recomendações da auditoria não foram implementadas. A branch apenas prepara infraestrutura/dados de demonstração e incorpora a versão visual local já desenvolvida anteriormente.

## Recuperação

Logs: .demo/server.log. Caso a compilação falhe, corrija a causa e execute node .devcontainer/bootstrap.mjs. O seed recusa sobrescrever um banco já preenchido. Para iniciar após uma preparação concluída, execute node .devcontainer/start.mjs.

Não promova esta configuração como produção. O banco da demo é isolado e o ambiente está identificado como desenvolvimento, embora rode o build otimizado do Next.js. O rollback é parar o Codespace e voltar à branch anterior; nenhum banco produtivo é afetado.
