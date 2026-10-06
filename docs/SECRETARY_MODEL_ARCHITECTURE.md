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
| Plano B | `packages/salon-secretary/src/model-fallback.ts` | Com `SALON_SECRETARY_FALLBACK_MODEL`, um modelo reserva de outro provedor responde o mesmo pedido quando o provedor do principal falha. Ver a seção "Plano B". |
| Gastos por carteira | `packages/salon-secretary/evaluation/program-spend.ts` | Um registro por pagador (OpenAI e OpenRouter), cada um com teto, âncora e estimadores próprios. As chamadas do OpenRouter são cobradas pelo custo real informado. Relatório: `node packages/salon-secretary/evaluation/program-spend-report.cjs`. |

O preço de telemetria (`secretary-router.ts`), o limite de tamanho do pedido (`request-budget.ts`) e a bateria Golden
(`free-use-runner.ts`) também leem o cadastro.

## Plano B (04/10/2026)

- **Quando aciona:** só por falha do provedor ou da conexão: erro HTTP do provedor (sem rota, sem crédito, limite de uso,
  queda), falha de conexão ou tempo esgotado. O mesmo pedido vai ao reserva, pelo formulário e pela trava do reserva.
- **Quando não aciona:**
  - recusa nossa: trava de custo e tetos de gasto, mesmo quando chegam embrulhadas como "erro de conexão";
  - chamada cancelada por quem pediu;
  - resposta que o conferente recusou. Isso é falha de qualidade, e o reserva a esconderia.
- **Tempo:** com reserva configurado, o principal tem 15 s de limite. O pior turno medido do DeepSeek foi 8,8 s em 270 turnos
  da Golden.
- **Disjuntor:** depois de 2 falhas seguidas, as chamadas vão direto ao reserva por 60 s. A primeira chamada depois disso tenta
  o principal de novo e, se ele responder, o disjuntor fecha.
- **Configuração:** `SALON_SECRETARY_FALLBACK_MODEL` com um modelo do cadastro, usando as credenciais da ficha dele. A fábrica
  recusa um reserva igual ao principal, sem credenciais, ou sem suporte ao agente e ao piloto quando eles estão ligados.
  A demo usa o `gpt-6-luna` como reserva (`SECRETARY_DEMO_FALLBACK=off` desliga).
- **Portão:** fora do desenvolvimento local e dos testes, o reserva só entra se também tiver certificado para o contrato dele;
  sem certificado, fica de fora com o aviso `SECRETARY_MODEL_FALLBACK_DISABLED`, e o principal segue sem plano B.
- **Telemetria:** o aviso `SECRETARY_MODEL_FALLBACK` traz só códigos (de, para, motivo, disjuntor). No uso, o turno mostra o
  modelo que respondeu (`model_id_returned`), registra o contrato desse modelo e fica sem estimativa de custo.
- **Avaliação:** a Golden mede um modelo de cada vez e recusa rodar com reserva configurado.
- **Prova real (04/10):** o OpenRouter foi forçado a falhar (servidor inexistente, recusa sem cobrança), e o Luna respondeu os
  dois turnos certos (3,3 s com a tentativa que falhou; 1,6 s com o disjuntor aberto), por US$ 0,0003.
- **Certificação do Luna como reserva (04/10): não passou.** Golden 3 vezes (`golden-20261004-luna-reserve-k3`, com o teto da
  OpenAI elevado para US$ 16 pelo dono). As rodadas 1 e 2 deram 30/30. Na 3ª:
  - no GF07, "Coloca a Escova Lisa por sessenta e cinco reais." virou cadastro de serviço novo em vez de mudar o preço da
    Escova Lisa que já existe;
  - "Corrigindo: sessenta e sete." virou 67 minutos, e a Secretária ofereceu para confirmar o cadastro de um serviço duplicado.
    Isso é falha de segurança. Nada foi gravado, porque a bateria não confirma.

  A bateria parou ali: 66 de 90, 23 sem executar, US$ 0,13. Sem certificado, o Luna segue como reserva só no local e na demo.
  O backend hoje não impede cadastrar um serviço com o nome de outro que já existe, com qualquer modelo.
- **Regra da reserva (05/10, decisão 44):** `MODEL_RESERVE_POLICY`, zero falhas de segurança e pelo menos 98% certo nas 3 rodadas;
  certificado com `role: "reserve"` (`npx tsx scripts/secretary-certify-model.ts <rodada> --reserve`), que nunca libera o modelo
  como principal. Com a trava de serviço repetido, o Luna fez 89/90 sem falha de segurança e foi certificado como reserva.

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

- **Agente C5 e piloto fora da OpenAI:** só se forem adotados. Hoje dependem do raciocínio criptografado e dos marcadores de
  cache da OpenAI.
- **Nomes neutros na telemetria** (`luna_*` → modelo), mantendo a leitura dos registros antigos.
