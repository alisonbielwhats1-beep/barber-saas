import { NoopTrace, withTrace, type AgentInputItem, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { agentRequestBodyBytes } from "./agent-loop";
import { assertSecretaryPilotAnchorProbeModelRequest } from "./openai-cost-guard";
import { PilotContractError, pilotToolsDigest, PILOT_CONTRACT_LIMITS, PILOT_REQUEST_LIMITS, PILOT_RESCHEDULE_TOOL } from "./pilot-reschedule-contract";
import { pilotResponseArguments, pilotSystemText, PILOT_CALL_LIMITS, PILOT_OPEN_LABELS, PILOT_PROMPT_EXAMPLE_NAMES, PILOT_REPAIR_RULES, PILOT_REPAIR_SHOWN, PILOT_REQUEST_CAP,
  type PilotAttempt, type PilotInterpretationCode, type PilotInterpretationTelemetry, type PilotRequestContext } from "./pilot-reschedule-prompt";
import { astarTool, decodeAstarInterpretationArguments, PILOT_ASTAR_CONTRACT_VERSION, PILOT_ASTAR_MENTION_DESCRIPTIONS, type AstarInterpretation } from "./pilot-astar-contract";

/** A* premise probe (docs/c5-spike/13-sonda-premissa-astar.md §1-§2; Adendo 12): the variant prompt, its request and its call loop, used ONLY by the
 * probe harness (packages/salon-secretary/evaluation/pilot-anchor-probe.ts). The E2-B prompt (pilot-reschedule-prompt.ts) is untouched and the real
 * flow never reads this file. Same wiring as E2-B: gpt-6-luna, store:false, the one strict tool forced, reasoning medium, at most 15 s per call and 45 s
 * per message, at most one format repair, the request measured and capped before it is sent. The prompt is the E2-B prompt with only rule 2 (its last
 * two bullets), the examples header and the examples that carry an offset changed: the starting point is taught by MEANING (evidence first, then what
 * those words do, then the starting point they name; a cited date or clock always typed in its own field; null, or the type "outro", when no word names
 * the starting point; Luna never decides what is ambiguous, the code computes every factual reading and asks when they differ). Invented examples with
 * contrast twins (a verb that moves the appointment against one that only places it; a deictic that is the start against one in a reason; the
 * appointment clock delayed against a cited clock), names outside every evaluation pool; never a list of words or phrases. */
export const PILOT_ASTAR_PROMPT = `Você transcreve, em campos, pedidos de remarcação que o dono de um salão escreve para a Secretária. Cada mensagem chega com dados do salão e você responde chamando interpretar_remarcacao uma única vez. Você não decide nada: o sistema confere cadastros, agenda, datas, expediente e vagas, e nada é gravado antes de o dono tocar em Confirmar.

Como preencher:
1. Toda "mencao" é uma cópia de um trecho da mensagem, com as palavras do dono. Nunca complete, corrija ou troque essas palavras por um nome da equipe ou do catálogo. Nas menções de nome (cliente.mencao, origem.profissional_mencao e destino.profissional.mencao) vão só as palavras do próprio nome, como foram escritas, sem artigo, preposição ou forma de tratamento (como "dona" ou "seu").
2. Dias e horas vão como operadores; você nunca calcula uma data nem um horário final.
   - Dia: "data" (número do dia; mês só se foi dito pelo nome ou pelo número), "mes_relativo" (número do dia de um mês dito em relação ao atual: meses 0 para este mês, 1 para o seguinte), "dia_semana" (o nome do dia, sem acento e sem "-feira": segunda, terca, quarta, quinta, sexta, sabado ou domingo; qualificador "este" ou "proximo" só quando essa palavra aparece), "mesmo_da_origem", "deslocamento" e "a_definir" (dia deixado em aberto, ou o dia dito antes retirado sem outro no lugar).
   - Hora: "relogio" (hora e minuto como foram ditos; periodo só quando manhã, tarde ou noite foi dito), "mesmo_da_origem", "deslocamento" e "a_definir" (hora deixada em aberto).
   - "mesmo_da_origem": o dia ou o horário do atendimento que já existe. "deslocamento": quantidade com sinal e unidade "dias" ou "semanas" (na hora, minutos com sinal; antes é negativo). Uma data ou hora de referência citada no deslocamento vai sempre em data_citada (o número do dia, sem tipo, com mês só se dito; um dia da semana, com tipo "dia_semana"; ou um dia de mês relativo, com tipo "mes_relativo") ou em hora_citada (como no relogio), seja ou não o ponto de partida; senão null.
   - No destino, ancora diz de onde o dono conta, nesta ordem: evidencia copia só as palavras dele que dizem de onde contar; tipo_evidencia diz o que elas fazem: "nomeia" (nomeiam o ponto de partida: o atendimento ou a referência citada), "deitico" (contam do presente) ou "desloca" (verbo que move o próprio atendimento por uma quantidade); tipo é o ponto nomeado: "origem" (o atendimento), "hoje" ou "agora" (o presente; amanhã é 1), "data_citada" ou "hora_citada". Quantidade, direção, verbo que só põe o atendimento num lugar, motivo ou nome não dizem de onde contar (tipo_evidencia "outro", que vale como não dito); se nada diz, ancora é null. Você nunca decide se algo é ambíguo nem escolhe um ponto não nomeado: o sistema calcula cada ponto possível e pergunta se os resultados divergirem.
3. "origem" guarda só as pistas que o dono deu para achar o atendimento já marcado: dia, hora, profissional, serviço e, em posicao, primeiro ou último do dia com a menção dessas palavras. Em origem.servico, "mencao" copia as palavras do dono sobre o serviço e "catalogo" traz os nomes exatos da lista de Serviços dos dados que essas palavras podem designar, escritos como na lista (um ou mais, no máximo ${PILOT_CONTRACT_LIMITS.catalogNames} nomes; [] se nenhum couber ou se mais de ${PILOT_CONTRACT_LIMITS.catalogNames} couberem). "destino" guarda o novo dia, a nova hora e quem atende: "manter" (o mesmo profissional), "nomeado" (o dono diz quem), "qualquer" (quem estiver livre, o atual inclusive), "outro" (alguém diferente do atual, sem dizer quem); nesses dois modos o sistema escolhe quem, mencao é null e excluidos traz quem não deve atender, um nome por item; sem nada sobre isso, null.
4. Você nunca escolhe qual pessoa, qual atendimento, que data final ou se há vaga.
5. Os campos guardam a remarcação de um único atendimento. fora_do_escopo é só para um pedido separado: uma ação à parte, com efeito próprio, que o dono quer que a Secretária faça além desta remarcação, como cancelar um atendimento, bloquear agenda, criar atendimento novo, trocar ou incluir serviço, repetir toda semana, mandar ao cliente um recado com outro conteúdo ou responder uma consulta pedida por si mesma. Cada item leva em "pedido" as palavras desse pedido. Uma segunda remarcação na mesma mensagem (de outra pessoa ou de outro atendimento) também é um pedido separado, como "outra_acao", com as palavras dela.
   - Fica dentro da remarcação e nunca vai para fora_do_escopo: o motivo, o contexto e as cortesias (saudação, desculpas, agradecimento); as correções da própria remarcação (o valor final vai no seu campo); as referências ao atendimento (de quem, qual, de quando, com quem, de qual serviço); as condições dela (se houver vaga, se couber, manter o mesmo profissional); as informações e preferências do cliente que não pedem nada ao salão; e a verificação de disponibilidade que serve a esta remarcação.
   - Tirar o atendimento deste cliente de um dia ou horário para pôr em outro é esta remarcação, mesmo dito como desmarcar e marcar de novo: nunca é cancelar mais agendar. Cancelar é pedido separado só quando um atendimento sai sem ganhar novo horário, ou quando é outro atendimento.
   - O sistema já avisa o cliente de toda remarcação: pedir para avisar este cliente desta mudança faz parte dela e vai em observacoes. Um recado com outro conteúdo, ou para outra pessoa, é pedido separado ("mensagem").
   - Fora o que fica dentro (acima), um trecho que pede, ou repassa como desejo do cliente, que o salão faça ou mude algo além do dia, do horário ou do profissional deste atendimento (outro serviço, repetir, outro atendimento, um recado com outro conteúdo) é pedido separado, mesmo escrito como informação.
   - Motivo, contexto, cortesia e informação vão em observacoes, cada trecho copiado da mensagem, no máximo ${PILOT_CONTRACT_LIMITS.observations} trechos; o que não couber fica de fora, sem copiar todo o contexto. O sistema não lê observacoes; o que tem campo próprio vai no seu campo.
   - tipo "remarcar" quando há só a remarcação, com ou sem contexto; "misto" quando há a remarcação e um pedido separado; "fora_do_escopo" quando há só pedido separado; "conversa" para saudação ou conversa sem pedido.
6. Com pergunta pendente nos dados: se a mensagem a responde, tipo "resposta" e resposta_a com o id dela, e o campo que ela pede vai preenchido com as palavras do dono (quando a pergunta lista opções, as palavras que ele usou para apontar uma delas: dia, hora, nome). Outro campo corrigido na mesma mensagem vai no seu lugar. Uma confirmação sem nome deixa cliente.mencao null. Entre parênteses, o pedido em aberto mostra o que o dono já disse e ainda não tem valor. Quando o campo pedido é quem não deve atender, os nomes vão em excluidos, com o modo do pedido em aberto; quem atende vai em nomeado.
7. aceita_parcial só responde a pergunta de fazer só a remarcação: true quando o dono aceita, false quando recusa, null em qualquer outro caso. desistir = true só quando o dono retira o pedido em aberto; isso não é cancelar o atendimento.
8. Campo sem informação fica null; observacoes, fora_do_escopo e excluidos sem itens são [].

Catorze exemplos inventados (só o formato; nomes e frases não existem em salão nenhum). Do quarto ao nono, o que parece outro pedido e não é fica na remarcação, e o pedido separado que parece contexto, conversa ou desejo do cliente vai em fora_do_escopo. Nos demais, de onde o dono conta e quem atende:
Mensagem: "Leva o Teodomiro de quinta para uma semana depois da data marcada, mesma hora, com a Floripes"
{"tipo":"remarcar","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Teodomiro"},"origem":{"dia":{"tipo":"dia_semana","dia_semana":"quinta","qualificador":null,"mencao":"de quinta"},"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":{"tipo":"deslocamento","quantidade":1,"unidade":"semanas","data_citada":null,"ancora":{"evidencia":"da data marcada","tipo_evidencia":"nomeia","tipo":"origem"},"mencao":"uma semana depois da data marcada"},"hora":{"tipo":"mesmo_da_origem","mencao":"mesma hora"},"profissional":{"modo":"nomeado","mencao":"Floripes","excluidos":[]}},"observacoes":[],"fora_do_escopo":[]}
Mensagem: "Joga o Gumercindo para amanhã 11h30 e apaga o lembrete dele"
{"tipo":"misto","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Gumercindo"},"origem":{"dia":null,"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":{"tipo":"deslocamento","quantidade":1,"unidade":"dias","data_citada":null,"ancora":{"evidencia":"amanhã","tipo_evidencia":"deitico","tipo":"hoje"},"mencao":"amanhã"},"hora":{"tipo":"relogio","hora":11,"minuto":30,"periodo":null,"mencao":"11h30"},"profissional":{"modo":null,"mencao":null,"excluidos":[]}},"observacoes":[],"fora_do_escopo":[{"tipo":"outra_acao","pedido":"apaga o lembrete dele"}]}
Mensagem: "Passa a dona Ermengarda, a do Lupércio, pro dia 3 do mês que vem às 16h e a Eulália pra sábado"
{"tipo":"misto","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Ermengarda"},"origem":{"dia":null,"hora":null,"profissional_mencao":"Lupércio","servico":null,"posicao":null},"destino":{"dia":{"tipo":"mes_relativo","dia":3,"meses":1,"mencao":"dia 3 do mês que vem"},"hora":{"tipo":"relogio","hora":16,"minuto":0,"periodo":null,"mencao":"16h"},"profissional":{"modo":null,"mencao":null,"excluidos":[]}},"observacoes":[],"fora_do_escopo":[{"tipo":"outra_acao","pedido":"a Eulália pra sábado"}]}
Mensagem: "Bom dia! A Leocádia quebrou o pé, coitada. Vê se a Floripes tem vaga e, se tiver, passa a progressiva dela de sexta para terça às 14h, não, às 15h"
{"tipo":"remarcar","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Leocádia"},"origem":{"dia":{"tipo":"dia_semana","dia_semana":"sexta","qualificador":null,"mencao":"de sexta"},"hora":null,"profissional_mencao":null,"servico":{"mencao":"progressiva","catalogo":["Escova progressiva"]},"posicao":null},"destino":{"dia":{"tipo":"dia_semana","dia_semana":"terca","qualificador":null,"mencao":"para terça"},"hora":{"tipo":"relogio","hora":15,"minuto":0,"periodo":null,"mencao":"às 15h"},"profissional":{"modo":"nomeado","mencao":"Floripes","excluidos":[]}},"observacoes":["Bom dia!","quebrou o pé, coitada","Vê se a Floripes tem vaga","às 14h, não"],"fora_do_escopo":[]}
Mensagem: "Por gentileza, o Teodomiro não pode amanhã: passa ele para segunda às 9h e já deixa a barba dele marcada logo depois"
{"tipo":"misto","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Teodomiro"},"origem":{"dia":{"tipo":"deslocamento","quantidade":1,"unidade":"dias","data_citada":null,"mencao":"amanhã"},"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":{"tipo":"dia_semana","dia_semana":"segunda","qualificador":null,"mencao":"para segunda"},"hora":{"tipo":"relogio","hora":9,"minuto":0,"periodo":null,"mencao":"às 9h"},"profissional":{"modo":null,"mencao":null,"excluidos":[]}},"observacoes":["Por gentileza","o Teodomiro não pode amanhã"],"fora_do_escopo":[{"tipo":"agendar","pedido":"já deixa a barba dele marcada logo depois"}]}
Mensagem: "Quantos encaixes ainda cabem para a Floripes no sábado? É só para eu me planejar."
{"tipo":"fora_do_escopo","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":null},"origem":{"dia":null,"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":null,"hora":null,"profissional":{"modo":null,"mencao":null,"excluidos":[]}},"observacoes":["É só para eu me planejar."],"fora_do_escopo":[{"tipo":"consultar","pedido":"Quantos encaixes ainda cabem para a Floripes no sábado?"}]}
Mensagem: "Desmarca a Hermenegilda de segunda e encaixa ela na quarta às 10h; a de sexta dela pode cancelar"
{"tipo":"misto","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Hermenegilda"},"origem":{"dia":{"tipo":"dia_semana","dia_semana":"segunda","qualificador":null,"mencao":"de segunda"},"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":{"tipo":"dia_semana","dia_semana":"quarta","qualificador":null,"mencao":"na quarta"},"hora":{"tipo":"relogio","hora":10,"minuto":0,"periodo":null,"mencao":"às 10h"},"profissional":{"modo":null,"mencao":null,"excluidos":[]}},"observacoes":[],"fora_do_escopo":[{"tipo":"cancelar","pedido":"a de sexta dela pode cancelar"}]}
Mensagem: "Coloca o Policarpo de terça na quinta às 18h, avisa ele e pede pra trazer a autorização assinada pela mãe"
{"tipo":"misto","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Policarpo"},"origem":{"dia":{"tipo":"dia_semana","dia_semana":"terca","qualificador":null,"mencao":"de terça"},"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":{"tipo":"dia_semana","dia_semana":"quinta","qualificador":null,"mencao":"na quinta"},"hora":{"tipo":"relogio","hora":18,"minuto":0,"periodo":null,"mencao":"às 18h"},"profissional":{"modo":null,"mencao":null,"excluidos":[]}},"observacoes":["avisa ele"],"fora_do_escopo":[{"tipo":"mensagem","pedido":"pede pra trazer a autorização assinada pela mãe"}]}
Mensagem: "A Ludovina pediu pra sair do sábado: põe ela no domingo às 9h. Ela é muito pontual; contou que quer incluir uma ozonioterapia e deixar fixo todo mês"
{"tipo":"misto","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Ludovina"},"origem":{"dia":{"tipo":"dia_semana","dia_semana":"sabado","qualificador":null,"mencao":"do sábado"},"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":{"tipo":"dia_semana","dia_semana":"domingo","qualificador":null,"mencao":"no domingo"},"hora":{"tipo":"relogio","hora":9,"minuto":0,"periodo":null,"mencao":"às 9h"},"profissional":{"modo":null,"mencao":null,"excluidos":[]}},"observacoes":["pediu pra sair do sábado","Ela é muito pontual"],"fora_do_escopo":[{"tipo":"trocar_servico","pedido":"quer incluir uma ozonioterapia"},{"tipo":"recorrencia","pedido":"deixar fixo todo mês"}]}
Mensagem: "Empurra a sessão da Zenóbia três dias para a frente, às 17h"
{"tipo":"remarcar","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Zenóbia"},"origem":{"dia":null,"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":{"tipo":"deslocamento","quantidade":3,"unidade":"dias","data_citada":null,"ancora":{"evidencia":"Empurra a sessão","tipo_evidencia":"desloca","tipo":"origem"},"mencao":"três dias para a frente"},"hora":{"tipo":"relogio","hora":17,"minuto":0,"periodo":null,"mencao":"às 17h"},"profissional":{"modo":null,"mencao":null,"excluidos":[]}},"observacoes":[],"fora_do_escopo":[]}
Mensagem: "O Eleutério viaja amanhã: passa ele para dois dias adiante, no mesmo horário"
{"tipo":"remarcar","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Eleutério"},"origem":{"dia":null,"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":{"tipo":"deslocamento","quantidade":2,"unidade":"dias","data_citada":null,"ancora":null,"mencao":"dois dias adiante"},"hora":{"tipo":"mesmo_da_origem","mencao":"no mesmo horário"},"profissional":{"modo":null,"mencao":null,"excluidos":[]}},"observacoes":["viaja amanhã"],"fora_do_escopo":[]}
Mensagem: "Põe a Teodolinda uma semana antes do 28, com qualquer um da equipe"
{"tipo":"remarcar","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Teodolinda"},"origem":{"dia":null,"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":{"tipo":"deslocamento","quantidade":-1,"unidade":"semanas","data_citada":{"dia":28,"mes":null,"mencao":"28"},"ancora":{"evidencia":"do 28","tipo_evidencia":"nomeia","tipo":"data_citada"},"mencao":"uma semana antes do 28"},"hora":null,"profissional":{"modo":"qualquer","mencao":null,"excluidos":[]}},"observacoes":[],"fora_do_escopo":[]}
Mensagem: "Atrasa o Hildebrando uma hora e quinze e passa ele para outra pessoa, sem ser a Floripes"
{"tipo":"remarcar","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Hildebrando"},"origem":{"dia":null,"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":null,"hora":{"tipo":"deslocamento","minutos":75,"hora_citada":null,"ancora":{"evidencia":"Atrasa","tipo_evidencia":"desloca","tipo":"origem"},"mencao":"uma hora e quinze"},"profissional":{"modo":"outro","mencao":null,"excluidos":["Floripes"]}},"observacoes":[],"fora_do_escopo":[]}
Mensagem: "Coloca a Sinforosa meia hora depois das 14h"
{"tipo":"remarcar","resposta_a":null,"desistir":false,"aceita_parcial":null,"cliente":{"mencao":"Sinforosa"},"origem":{"dia":null,"hora":null,"profissional_mencao":null,"servico":null,"posicao":null},"destino":{"dia":null,"hora":{"tipo":"deslocamento","minutos":30,"hora_citada":{"hora":14,"minuto":0,"periodo":null,"mencao":"14h"},"ancora":{"evidencia":"das 14h","tipo_evidencia":"nomeia","tipo":"hora_citada"},"mencao":"meia hora depois das 14h"},"profissional":{"modo":null,"mencao":null,"excluidos":[]}},"observacoes":[],"fora_do_escopo":[]}`;
/** The example names (absent from every evaluation name pool; a lint test keeps it so): the E2-B names and the one of the cited-clock example. */
export const PILOT_ASTAR_PROMPT_EXAMPLE_NAMES = Object.freeze([...PILOT_PROMPT_EXAMPLE_NAMES, "Sinforosa"]);
/** The model of the probe (decision 19); the harness refuses any other. */
export const PILOT_ASTAR_MODEL = "gpt-6-luna" as const;
/** The repair rules of the variant: the E2-B ones minus the three anchor rules (spec 13 §2), with the same fixed sentences. */
export const PILOT_ASTAR_REPAIR_RULES = Object.freeze({
  "RULE:misto_sem_fora_do_escopo": PILOT_REPAIR_RULES["RULE:misto_sem_fora_do_escopo"],
  "RULE:nomeado_sem_mencao": PILOT_REPAIR_RULES["RULE:nomeado_sem_mencao"],
  "RULE:excluidos_sem_delegacao": PILOT_REPAIR_RULES["RULE:excluidos_sem_delegacao"],
} as const);
/** The repair note of the variant (codes and schema paths only, never text the model wrote): the E2-B note over the variant rules. */
export const astarRepairText = (reasons: readonly string[]) => {
  const rules = PILOT_ASTAR_REPAIR_RULES as Readonly<Record<string, string>>, isRule = (code: string) => Object.prototype.hasOwnProperty.call(rules, code);
  const unique = [...new Set(reasons)], ordered = [...unique.filter(isRule), ...unique.filter(code => !isRule(code))];
  const shown = ordered.slice(0, PILOT_REPAIR_SHOWN), omitted = ordered.length - shown.length;
  const sentences = [...new Set(ordered.filter(isRule).map(code => rules[code]))];
  return `A chamada anterior não seguiu o esquema de ${PILOT_RESCHEDULE_TOOL} (${shown.join(", ")}${omitted ? `, e mais ${omitted}` : ""}).${sentences.map(sentence => ` ${sentence}`).join("")} Chame ${PILOT_RESCHEDULE_TOOL} de novo, com todos os campos do esquema.`;
};
const attempts = new WeakMap<ModelRequest, PilotAttempt>();
/** Which call of the message a request is (the interpretation or its repair); set only on requests built here. */
export const astarAttempt = (request: ModelRequest): PilotAttempt | undefined => attempts.get(request);
/** The request of one probe call: the variant prompt and tool, the data input (pilotSystemText, the E2-B layout), the message and, with `repair`, the note. */
export function astarRequest(context: PilotRequestContext, message: string, options: { repair?: readonly string[]; signal?: AbortSignal } = {}): ModelRequest {
  const input: AgentInputItem[] = [{ role: "system", content: pilotSystemText(context) }, { role: "user", content: message },
    ...(options.repair ? [{ role: "system", content: astarRepairText(options.repair) } as AgentInputItem] : [])];
  const request: ModelRequest = { systemInstructions: PILOT_ASTAR_PROMPT, input,
    modelSettings: { toolChoice: PILOT_RESCHEDULE_TOOL, parallelToolCalls: false, maxTokens: PILOT_REQUEST_LIMITS.maxOutputTokens, store: false,
      reasoning: { effort: PILOT_REQUEST_LIMITS.effort } },
    tools: [astarTool() as unknown as ModelRequest["tools"][number]], toolsExplicitlyProvided: true, outputType: "text", handoffs: [], tracing: false, ...(options.signal ? { signal: options.signal } : {}) };
  attempts.set(request, options.repair ? { attempt: 2, purpose: "PILOT_REPAIR" } : { attempt: 1, purpose: "PILOT_INTERPRETATION" });
  return request;
}
/** What the version of the variant names (pre-registered by its sha before the probe runs): the prompt, the data layout over a fixed synthetic context,
 * the repair note and rules, the summary words, the tool, the request and call limits, the model and whether the mencao descriptions are kept. */
export const astarContractParts = () => ({ version: PILOT_ASTAR_CONTRACT_VERSION, model: PILOT_ASTAR_MODEL, prompt: PILOT_ASTAR_PROMPT, labels: PILOT_OPEN_LABELS,
  repair: astarRepairText(["«código»"]), repairRules: PILOT_ASTAR_REPAIR_RULES,
  system: pilotSystemText({ today: { date: "2000-01-01", weekday: "«dia»", timezone: "«fuso»" }, team: ["«profissional»"], services: ["«serviço»"],
    open: { lines: ["«campo»"], question: { questionId: "q1", field: "«campo»", reason: "«motivo»", options: ["«opção»"] } } }),
  tool: astarTool(), limits: PILOT_REQUEST_LIMITS, cap: PILOT_REQUEST_CAP, calls: PILOT_CALL_LIMITS, mentionDescriptions: PILOT_ASTAR_MENTION_DESCRIPTIONS });
/** sha256 of the canonical JSON of the parts (keys sorted at every level): the contract+prompt version the probe is pre-registered under. */
export const PILOT_ASTAR_CONTRACT_SHA256 = pilotToolsDigest([astarContractParts()]);

/** `raw`: the arguments string of every call that returned one, in order (written only to the sealed detail folder; never printed). */
export type AstarInterpretationOutcome = { ok: true; interpretation: AstarInterpretation; telemetry: PilotInterpretationTelemetry; raw: string[] }
  | { ok: false; code: PilotInterpretationCode; telemetry: PilotInterpretationTelemetry; raw: string[] };
/** One owner message of the probe: the interpretation and at most one format repair, each call ≤ 15 s, all within 45 s of `startedAt`, the request
 * guarded, measured and capped before it is sent (the E2-B loop over the variant). Never throws for the model's behaviour. */
export async function runAstarInterpretation(model: Model, input: { context: PilotRequestContext; message: string; modelId: string; startedAt: number }): Promise<AstarInterpretationOutcome> {
  const telemetry = { calls: 0, repaired: false, schema: [] as string[], request_bytes: [] as number[] }, raw: string[] = [];
  const done = (code: PilotInterpretationCode): AstarInterpretationOutcome => ({ ok: false, code, telemetry, raw });
  let repair: readonly string[] | undefined, excluded: string[] = [];
  for (let call = 1; call <= PILOT_CALL_LIMITS.modelCalls; call++) {
    const left = input.startedAt + PILOT_CALL_LIMITS.messageMs - performance.now();
    if (left <= 0) return done("PILOT_DEADLINE");
    const signal = AbortSignal.timeout(Math.max(1, Math.min(PILOT_CALL_LIMITS.callMs, left)));
    const request = astarRequest(input.context, input.message, { ...(repair ? { repair } : {}), signal });
    try { assertSecretaryPilotAnchorProbeModelRequest(request); } catch { return done("PILOT_GUARD"); }
    let bytes: number;
    try { bytes = agentRequestBodyBytes(request, input.modelId); } catch { return done("PILOT_BUDGET_UNMEASURED"); }
    if (!Number.isFinite(bytes)) return done("PILOT_BUDGET_UNMEASURED");
    telemetry.request_bytes.push(bytes);
    if (bytes + PILOT_REQUEST_CAP.outputFraming > PILOT_REQUEST_CAP.requestCap) return done("PILOT_BUDGET");
    telemetry.calls++; telemetry.repaired = !!repair;
    let response: ModelResponse;
    try { response = await withTrace(new NoopTrace(), () => model.getResponse(request)); }
    catch { return done(signal.aborted ? "PILOT_DEADLINE" : "PILOT_TRANSPORT"); }
    let args: string | undefined;
    try {
      args = pilotResponseArguments(response);
      raw.push(args);
      const interpretation = decodeAstarInterpretationArguments(args);
      // As in E2-B (§11.10, R1-PROFESSIONAL-5): a repair never drops a name the first call typed as who must not attend (typed values compared).
      const said = interpretation.destino.profissional, kept = exclusionNames(said), lost = excluded.filter(name => !kept.includes(name));
      const named = said.modo === "nomeado" && said.mencao ? foldedName(said.mencao) : undefined;
      if (lost.length && !(named && !lost.includes(named))) { telemetry.schema = [...telemetry.schema, "REPAIR_DROPPED_EXCLUSION"]; return done("PILOT_SCHEMA"); }
      return { ok: true, interpretation, telemetry, raw };
    } catch (error) {
      const reasons = error instanceof PilotContractError ? [...error.reasons] : ["DECODE"];
      telemetry.schema = reasons; repair = reasons; excluded = typedExclusions(args);
    }
  }
  return done("PILOT_SCHEMA");
}
/** The E2-B comparison of names between the two calls of one message (typed values, never the owner's text). */
const foldedName = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
const exclusionNames = (said: { modo?: unknown; mencao?: unknown; excluidos?: unknown }): string[] =>
  [...(said.modo === "outro" && typeof said.mencao === "string" ? [said.mencao] : []), ...(Array.isArray(said.excluidos) ? said.excluidos : [])]
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0).map(foldedName);
function typedExclusions(args: string | undefined): string[] {
  try {
    const said = args ? (JSON.parse(args) as { destino?: { profissional?: unknown } })?.destino?.profissional : undefined;
    return said && typeof said === "object" ? exclusionNames(said as { modo?: unknown; mencao?: unknown; excluidos?: unknown }) : [];
  } catch { return []; }
}
