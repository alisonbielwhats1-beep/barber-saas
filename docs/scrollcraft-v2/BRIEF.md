# ScrollCraft — revisão com camadas e movimento

Self-authored under explicit creative delegation. Revisão orientada pelo feedback do usuário.

## Direção

1. Vibe: premium, editorial, espacial e tecnológica; clara para beleza, preto/carvão neutro para barbearia. Verde removido do dark.
2. Jornada: reconhecer o estabelecimento → abrir o cenário por scroll → conhecer o sistema em uma cena exclusiva → entender recursos → criar o estabelecimento.
3. Energia: movimento ambiente na entrada; abertura de profundidade como pico; demonstração e recursos em ritmo mais calmo.
4. Sentimento: identificação, descoberta, clareza, confiança. Pico: “É o site em que o ambiente se abre ao rolar e muda para a minha barbearia.”
5. Assinatura: um portal de vidro e arquitetura se abre; a fotografia cresce enquanto planos próximos se afastam, sem sobrepor uma agenda à foto.
6. Estética: premium editorial, com movimento visível e sem ruído de efeitos repetidos.
7. Cenas distintas, não um voo contínuo. Hero com pin curto, demonstração independente, narrativa por texto, recursos em pilha no desktop; planos em fluxo normal.
8. Assets: fotografias existentes desta tarefa; nova arquitetura, recorte transparente de vidro e imagem conceitual do sistema gerados pela ferramenta nativa. Vídeo ambiente local de luz em movimento; nenhuma filmagem de cliente ou funcionalidade fictícia.

## Evidência da referência

[AI Automation Society](https://aiautomationsociety.ai/) inspecionado em 1440×1000 nas posições 0, 600, 1300 e 2200. O hero possui sky, ridge-far, ridge-mid, conteúdo/device, ridge-front e floor. O primeiro plano passa na frente da superfície central e resolve no fundo da seção seguinte. Adaptamos separação, oclusão e velocidades diferentes. Não copiamos montanhas, imagens, composição literal, código ou marca.

## Contrato de camadas

| Plano | Asset | Movimento | Relação espacial |
|---|---|---|---|
| Fundo distante | Arquitetura limpa sem pessoas | 36 px de deslocamento, escala fixa 1,04 | Atrás de toda a cena |
| Atmosfera | Vídeo de luz/refração em loop, sem áudio | Movimento próprio; pausa fora da tela | Suave, sem comprometer texto |
| Texto | HTML acessível | Recede e sai durante o pin | Headline e CTA completos na entrada |
| Assunto | Fotografia do segmento em portal | Cresce e sobe até 430 px no desktop e 290 px no mobile | Nunca recebe o painel da agenda por cima |
| Primeiro plano | Vidro translúcido com alpha real | Maior expansão/deslocamento que o fundo | Oculta só as bordas inferiores do portal |
| Saída | Legenda e indicador de progresso | Segundo beat legível | A cena termina antes da demonstração do sistema |

Abertura: texto em espaço negativo e portal parcialmente enquadrado. Meio: primeiro plano se afasta, foto se aproxima e texto recua. Saída: fotografia desimpedida, legenda e corte limpo para a cena do produto. Mobile tem distâncias menores, enquadramento próprio e CTA sempre alcançável. Reduced motion remove pin extra e movimento automático, mantendo todas as informações.

## Segmentos automáticos

Alternância a cada oito segundos na abertura visível. Pausa explícita, pausa por foco/hover, aba oculta e hero fora da tela. Clique manual seleciona imediatamente e dá 16 segundos de leitura antes de retomar. Reduced motion começa pausado, com opção explícita de ativar a alternância. Escolha armazenada acompanha login/cadastro; não escreve dados cadastrais automaticamente.

## Cadastro

Reutilizar formulários, ações, validações, serviços sugeridos e redirecionamentos existentes. Renovar o shell de `/signup` e `/onboarding/create-salon`. A rota autenticada mantém seus guards e consultas intactos. O plano Grátis cria estabelecimento aprovado e auto-login imediato, confirmado em `signup/actions.ts`; aprovação de upgrade é um fluxo separado.
