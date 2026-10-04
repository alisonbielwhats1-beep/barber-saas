# Arquitetura de modelos da Secretária (04/10/2026)

Pedido do dono (04/10/2026): trocar de LLM tem que ser configuração e prova, nunca reescrita, sem perder a qualidade dos
resultados. Este documento descreve como isso funciona e o passo a passo para trocar ou acrescentar um modelo.

## Princípio

A IA entende e o backend confere. O modelo só preenche o formulário da ferramenta forçada. O conferente valida cada campo,
o backend resolve cadastros, datas e regras, e nada é gravado sem o Confirmar autenticado. Por isso trocar de modelo nunca
virou risco de segurança: mesmo quando o DeepSeek acertava só 3 de 30, nenhuma ação errada foi gravada. O risco de uma troca
é de **qualidade**, e por isso a troca passa por um portão de qualidade.

## As peças

| Peça | Arquivo | O que faz |
|---|---|---|
| Cadastro de modelos | `packages/salon-secretary/src/model-registry.ts` | Uma ficha por modelo: formato (Responses da OpenAI ou Chat Completions), carteira, endereço, credenciais, o que ele suporta (agente C5 e piloto só na OpenAI), perfil de pedido e preço. `DEFAULT_SECRETARY_MODEL` é o modelo da Secretária. |
| Adaptador Chat Completions | `packages/salon-secretary/src/chat-completions-wire.ts` | Monta o pedido do provedor a partir do perfil (`strict`, temperatura, raciocínio, servidor fixo) e completa os campos que o modelo omitiu, guiado pelo esquema. |
| Trava de custo | `packages/salon-secretary/src/openai-cost-guard.ts` | Admite só modelos do cadastro, só o endereço da ficha e só o formato C4 (ou os formatos do agente e do piloto, na OpenAI). |
| Fábrica | `createPaidModel` em `packages/salon-secretary/src/index.ts` | Lê a ficha e cria o cliente certo; recusa o agente e o piloto em modelo sem esse suporte. |
| Contrato | `secretaryContractVersion` (`index.ts`) | Hash de tudo o que chega ao modelo: prompt, formulário, opções, limite de saída, modelo e, nos modelos de chat, o perfil de pedido. |
| Portão de qualidade | `packages/salon-secretary/src/model-certification.ts`, `packages/salon-secretary/model-certificates.json`, `scripts/secretary-certify-model.ts` | Fora do desenvolvimento local e dos testes (staging, produção), o modelo só responde se tiver certificado da Golden para o contrato atual. O teste `secretary-model-certification.test.ts` falha quando o modelo da Secretária fica sem certificado válido. |
| Gastos por carteira | `packages/salon-secretary/evaluation/program-spend.ts` | Um registro por pagador (OpenAI e OpenRouter), cada um com teto, âncora e estimadores próprios. As chamadas do OpenRouter são cobradas pelo custo real informado. Relatório: `node packages/salon-secretary/evaluation/program-spend-report.cjs`. |

O preço de telemetria (`secretary-router.ts`), o limite de tamanho do pedido (`request-budget.ts`) e a bateria Golden
(`free-use-runner.ts`) também leem o cadastro.

## Certificado (política)

- **Bateria:** a Golden 30 (`golden-free-use-30`), repetida pelo menos 3 vezes.
- **Acerto:** todos os casos certos em todas as rodadas.
- **Segurança:** nenhuma falha de segurança, nada bloqueado e nada sem executar.
- **Validade:** o certificado guarda o contrato que a rodada mediu e as variáveis de contrato dela. Qualquer mudança de prompt,
  formulário, opção ou perfil de pedido deixa o modelo sem certificado até a bateria rodar de novo.

## Trocar de modelo (um modelo já cadastrado)

1. Ajuste `SALON_SECRETARY_MODEL` (por exemplo, `gpt-6-luna`) e a chave da ficha.
2. Se o modelo não tem certificado para o contrato atual, rode a Golden 3 vezes e registre o certificado (seção seguinte).
   Em local e nos testes ele roda mesmo assim; em staging e produção o portão recusa (`SECRETARY_MODEL_NOT_CERTIFIED`).
3. Para mudar o modelo **padrão** da Secretária: troque `DEFAULT_SECRETARY_MODEL` e regrave `contract-version.json`
   (`npx tsx scripts/secretary-contract-version.ts --write`) depois das baterias.

## Acrescentar um modelo novo

1. **Ficha no cadastro** (`model-registry.ts`): id, formato, carteira, endereço, chave, perfil de pedido e preço.
   - Um modelo do OpenRouter usa a carteira `openrouter`.
   - O preço precisa caber no teto de reserva `OPENROUTER_RESERVATION_PRICING`; se não couber, é preciso uma nova versão selada.
2. **Missão de avaliação** (`free-use-budget.ts`): preço selado da missão, com o campo `model` igual ao id da ficha, e teto
   de reservas aprovado pelo dono. O executor da Golden aceita qualquer modelo que tenha missão.
3. **Medir:**
   ```bash
   node scripts/run-secretary-golden-model.cjs --model <id> --prepare --repeat 3 --out <run>
   ```
   Depois rode `--model <id> --run <sha> --out <run>` com o sha que o preparo imprimir. O lançador usa as mesmas flags da prova
   do Luna de 30/09 (perfil de certificação), o banco local descartável e a missão e a carteira do modelo. Se o modelo errar
   muito, compare os pedidos e ajuste o perfil de pedido, sem mexer em regras de frase.
4. **Certificar:**
   ```bash
   npx tsx scripts/secretary-certify-model.ts <run>
   ```
   O script recusa rodada fraca, rodada parcial e rodada cujo contrato o código atual já não produz.

## O que a troca para o DeepSeek ensinou

Lições que valem para qualquer modelo fora da OpenAI:
- **`strict` desligado:** com o formulário forçado caractere por caractere, as respostas saíam deformadas (Golden 3/30).
- **Campos omitidos:** sem `strict`, o modelo omite os campos vazios. O adaptador completa os campos que aceitam nulo e as
  listas obrigatórias (`[]`), sem nunca inventar valor.
- **Raciocínio desligado e temperatura 0:** a mesma frase passa a ter a mesma leitura, mais rápido.
- **Parâmetros que poucos provedores aceitam** (`parallel_tool_calls`) tiram a rota inteira: dá 404 com `require_parameters`.

## Próximos passos (fase 2)

- **Plano B automático:** se o provedor principal falhar ou demorar, cair para um modelo reserva também certificado.
- **Agente C5 e piloto fora da OpenAI:** só se forem adotados. Hoje dependem do raciocínio criptografado e dos marcadores de
  cache da OpenAI.
- **Nomes neutros na telemetria** (`luna_*` → modelo), mantendo a leitura dos registros antigos.
