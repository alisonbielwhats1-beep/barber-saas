# Restauração visual — referência 6fd3d21

O usuário rejeitou o fundo verde da proposta anterior e pediu a referência
do commit 6fd3d21. Esta decisão substitui a proposta verde/areia de 06/09/2026.

Restaurados os tokens de superfícies, botões e acentos administrativos e do
cliente a partir desse commit. Fundo grafite no escuro, cinza claro no claro,
cartões neutros e verde nos destaques. Navegação, gráfico de receita e acentos
dos indicadores seguem novamente a referência. A landing não foi alterada.

Mantidos o logo administrativo compacto, a remoção da foto apenas do painel,
as correções funcionais posteriores e os nomes acessíveis dos gráficos.
Preservados ajustes de legibilidade em textos secundários e alertas. O verde
do tema claro foi escurecido de L=36% para L=30% para manter contraste em botões
e em textos sobre superfícies levemente tingidas.

Commit da demonstração: 106ac1154c700190954be7ec2b0cc2a13e7c012b.
Produção não foi alterada nesta revisão.

Lint, TypeScript e 659 testes aprovados. Build no Codespace aprovado. Verificação
autenticada: seis checks de fluxo, dez capturas desktop/mobile, zero erros de
execução e zero violações nas regras axe verificadas. A captura do painel escuro
foi inspecionada visualmente, confirmando superfícies grafite. Testes feitos com
dados fictícios, sem acesso aos bancos produtivos.

Evidências remotas: .demo/neutral-restore-build-verified.log,
.demo/neutral-restore-browser-verified.log e
artifacts/audit-2026-09-06/refinement-browser-report.json.
