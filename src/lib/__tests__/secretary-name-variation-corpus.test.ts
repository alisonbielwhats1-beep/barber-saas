import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { phoneticToken, rankNameSuggestions, samePhoneticName } from "../name-search";

/** Owner 05/10: "não podemos ter overfitting; tem que valer para vários nomes e possibilidades". A corpus of Brazilian name
 * variations in both directions: what must be the same person (one sound), what must never be confused (different people),
 * what is only a suggestion (a click), and a realistic client directory where every spoken name finds exactly one person. */
beforeEach(() => vi.stubEnv("SALON_SECRETARY_PHONETIC_NAMES", "true"));
afterEach(() => vi.unstubAllEnvs());

/** Same sound, another spelling: one key (a lone match may be taken; Confirmar still shows the full name). */
const SAME: [string, string][] = [
  // W/V, U
  ["Walter", "Valter"], ["Wagner", "Vagner"], ["Wanderley", "Vanderlei"], ["Wellington", "Welington"], ["Wilson", "Vilson"], ["Osvaldo", "Oswaldo"],
  ["Wanessa", "Vanessa"], ["Edvaldo", "Edwaldo"],
  // Y/I
  ["Thaís", "Thays"], ["Taís", "Thaís"], ["Kelly", "Keli"], ["Daiane", "Dayane"], ["Dayanne", "Daiane"], ["Yasmin", "Iasmin"], ["Ygor", "Igor"],
  ["Thaynara", "Tainara"], ["Iara", "Yara"], ["Raíssa", "Rayssa"], ["Suely", "Sueli"], ["Nathaly", "Natali"], ["Kaylane", "Kailane"], ["Mayara", "Maiara"],
  // doubled letters
  ["Isabella", "Isabela"], ["Gabriella", "Gabriela"], ["Daniella", "Daniela"], ["Camilla", "Camila"], ["Priscilla", "Priscila"], ["Anna", "Ana"],
  ["Rebecca", "Rebeca"], ["Matteus", "Mateus"], ["Emmanuel", "Emanuel"], ["Suellen", "Suelen"], ["Hellen", "Helen"], ["Allan", "Alan"],
  ["Jefferson", "Jeferson"], ["Isaac", "Isac"], ["Giovanna", "Giovana"], ["Marcella", "Marcela"], ["Ingrid", "Ingrid"], ["Karinne", "Karine"],
  // TH/PH/H
  ["Thiago", "Tiago"], ["Matheus", "Mateus"], ["Thalita", "Talita"], ["Nathália", "Natália"], ["Bethânia", "Betânia"], ["Thomas", "Tomás"],
  ["Raphael", "Rafael"], ["Sophia", "Sofia"], ["Stephany", "Stefany"], ["Phelipe", "Felipe"], ["Helena", "Elena"], ["Heloísa", "Eloísa"],
  ["Hugo", "Ugo"], ["Jhonatan", "Jonatan"], ["Jonathan", "Jonatan"], ["Rhuan", "Ruan"], ["Khalil", "Kalil"], ["Esther", "Ester"],
  // K/C/QU, CK
  ["Kauan", "Cauan"], ["Kauã", "Cauã"], ["Kauã", "Kauan"], ["Karen", "Caren"], ["Kátia", "Cátia"], ["Érica", "Erika"], ["Mônica", "Monika"],
  ["Raquel", "Rakel"], ["Erick", "Eric"], ["Patrick", "Patric"], ["Kaique", "Caique"], ["Henrique", "Henrike"], ["Kelvin", "Kelvin"],
  ["Marcos", "Markos"], ["Carla", "Karla"], ["Cássio", "Kássio"],
  // Z/S, C/S, G/J, X/CH
  ["Souza", "Sousa"], ["Luiza", "Luisa"], ["Elisa", "Eliza"], ["Assunção", "Assunsão"], ["Graça", "Grassa"], ["Thereza", "Teresa"], ["Isadora", "Izadora"], ["Rezende", "Resende"], ["Neuza", "Neusa"],
  ["Cecília", "Secília"], ["Celina", "Selina"], ["Gessica", "Jéssica"], ["Jean", "Gean"], ["Geovana", "Jeovana"], ["Gisele", "Jisele"],
  ["Xavier", "Chavier"], ["Xuxa", "Chucha"], ["Shirley", "Xirlei"],
  // nasal and final letters, initial ES
  ["Yasmim", "Yasmin"], ["Joaquim", "Joaquin"], ["Stephanie", "Stefany"], ["Estela", "Stela"], ["Stella", "Estela"],
  // accents, case, articles, spacing (always the same name)
  ["joão", "João"], ["JOSÉ", "José"], ["Antônio", "Antonio"], ["Conceição", "Conceicao"], ["Assunção", "Assuncao"], ["Falcão", "Falcao"], ["Lúcia", "Lucia"],
];

/** Different people: never one key (a vowel is never merged; letter order is kept). */
const DIFFERENT: [string, string][] = [
  ["Rafael", "Rafaela"], ["Gabriel", "Gabriela"], ["Daniel", "Daniela"], ["Fernando", "Fernanda"], ["Bruno", "Bruna"], ["Paulo", "Paula"],
  ["Mario", "Maria"], ["Lucas", "Lucia"], ["Carla", "Clara"], ["Lena", "Lina"], ["Ana", "Ane"], ["Marta", "Maria"], ["Lara", "Laura"],
  ["Vera", "Vita"], ["Walter", "Vanessa"], ["Valter", "Vagner"], ["Vitor", "Vitoria"], ["Joana", "Joao"], ["Rita", "Rute"], ["Ivo", "Ivone"],
  ["Diego", "Diogo"], ["Renan", "Renata"], ["Juliana", "Julia"], ["Luana", "Luciana"], ["Tais", "Tania"], ["Igor", "Iago"],
  ["Sara", "Sabrina"], ["Camila", "Carmela"], ["Marcia", "Marcio"], ["Alice", "Aline"], ["Celia", "Cecilia"],
  ["Gisele", "Giseli"], ["Kelly", "Kelvin"], ["Caio", "Kaique"], ["Leandro", "Leonardo"], ["Murilo", "Marilia"], ["Pedro", "Petra"],
  ["Nina", "Nana"], ["Ester", "Estela"], ["Helena", "Helen"], ["Tiago", "Iago"], ["Sofia", "Sonia"], ["Eric", "Erica"], ["Jean", "Joana"],
  ["Karen", "Karina"], ["Mateus", "Mateo"], ["Isabela", "Isabel"], ["Andre", "Andrea"], ["Simone", "Simao"], ["Rosa", "Rose"], ["Davi", "David"],
  ["Luiz", "Luiza"], ["Edson", "Edison"], ["Felipe", "Filipe"], ["Lourdes", "Lurdes"], ["Gustavo", "Augusto"], ["Beatriz", "Bia"],
];

/** Similar, a click only: one letter of difference, a nickname, a diminutive (never one key). */
const SIMILAR: [string, string][] = [
  ["Filipe", "Felipe Andrade"], ["Lurdes", "Lourdes Pereira"], ["Edison", "Edson Lima"], ["Giovana", "Geovana Prado"], ["Dirce", "Dirceu Alves"], ["Wesly", "Wesley Batista"],
  ["Bia", "Beatriz Gomes"], ["Duda", "Eduarda Ribeiro"], ["Nanda", "Fernanda Lopes"], ["Zé", "José Carlos"], ["Chico", "Francisco Moura"],
  ["Beto", "Roberto Nunes"], ["Guto", "Augusto Faria"], ["Gabi", "Gabriela Costa"], ["Mila", "Camila Duarte"], ["Dri", "Adriana Pires"],
  ["Tonho", "Antônio Leal"], ["Malu", "Luiza Fernandes"], ["Dudu", "Eduardo Matos"],
  ["Fabinho", "Fábio Rocha"], ["Paulinha", "Paula Mendes"], ["Carlinhos", "Carlos Alberto"], ["Aninha", "Ana Clara"], ["Joãozinho", "João Pedro"],
  ["Dani", "Daniela Barros"], ["Rafa", "Rafaela Torres"], ["Carol", "Carolina Dias"], ["Tati", "Tatiana Moraes"], ["Leo", "Leonardo Reis"],
];

/** A realistic client directory: every spoken variant must find exactly its person by sound, and never anyone else. */
const DIRECTORY = [
  "Valter Assunção", "Wagner Pinto", "Vanessa Correia", "Wanderley Souza", "Isabela Mattos", "Isabel Cristina", "Gabriela Costa", "Gabriel Ramos",
  "Daniela Barros", "Daniel Teixeira", "Thiago Mendes", "Iago Ferreira", "Matheus Quintela", "Mateo Silva", "Thaís Rocha", "Tânia Lopes",
  "Kelly Prates", "Kelvin Araújo", "Daiane Moura", "Yasmin Okada", "Igor Santana", "Raíssa Monteiro", "Rafael Duarte", "Rafaela Torres",
  "Natália Campos", "Talita Nogueira", "Sofia Martins", "Sônia Freitas", "Helena Prado", "Helen Cardoso", "Heloísa Batista", "Hugo Lima",
  "Jonatan Alves", "Ruan Pacheco", "Kauan Rodrigues", "Karen Vieira", "Karina Melo", "Cátia Brito", "Érica Nunes", "Eric Santos",
  "Mônica Reis", "Raquel Azevedo", "Patrick Gomes", "Kaique Yamamoto", "Henrique Costa", "Carla Dias", "Clara Moreira", "Luiza Fernandes",
  "Luiz Carlos", "Teresa Pires", "Isadora Lins", "Cecília Andrade", "Célia Barbosa", "Jéssica Ribeiro", "Jean Pereira", "Joana Machado",
  "Geovana Prado", "Giovana Rocha", "Gisele Moraes", "Xavier Lopes", "Shirley Matos", "Joaquim Neves", "Estela Rangel", "Stephanie Lima",
  "Esther Campos", "Neusa Oliveira", "Wellington Dias", "Wilson Barros", "Osvaldo Ramos", "Suely Nascimento", "Mayara Teles", "Suelen Alves",
  "Alan Rocha", "Jeferson Lima", "Rebeca Souza", "Emanuel Costa", "Priscila Gomes", "Camila Duarte", "Marcela Pinto", "Ana Clara",
  "Ane Moraes", "Lena Rocha", "Lina Sousa", "Paula Mendes", "Paulo Henrique", "Bruna Lima", "Bruno Alves", "Fernanda Lopes", "Fernando Reis",
  "Maria Eduarda", "Mario Souza", "Lucas Martins", "Lúcia Freitas", "Vitor Hugo", "Vitória Ramos", "Diego Nunes", "Diogo Campos",
  "Felipe Andrade", "Filipe Moura", "Edson Lima", "Edison Prado", "Beatriz Gomes", "Eduarda Ribeiro", "José Carlos", "Francisco Moura",
];
const SPOKEN: [string, string][] = [
  ["Walter", "Valter Assunção"], ["Vagner", "Wagner Pinto"], ["Wanessa", "Vanessa Correia"], ["Vanderlei", "Wanderley Souza"],
  ["Isabella", "Isabela Mattos"], ["Gabriella", "Gabriela Costa"], ["Daniella", "Daniela Barros"], ["Tiago", "Thiago Mendes"],
  ["Mateus", "Matheus Quintela"], ["Thays", "Thaís Rocha"], ["Keli", "Kelly Prates"], ["Dayane", "Daiane Moura"], ["Iasmin", "Yasmin Okada"],
  ["Ygor", "Igor Santana"], ["Rayssa", "Raíssa Monteiro"], ["Raphael", "Rafael Duarte"], ["Nathália", "Natália Campos"], ["Thalita", "Talita Nogueira"],
  ["Sophia", "Sofia Martins"], ["Elena", "Helena Prado"], ["Hellen", "Helen Cardoso"], ["Eloísa", "Heloísa Batista"], ["Jhonatan", "Jonatan Alves"],
  ["Rhuan", "Ruan Pacheco"], ["Cauã", "Kauan Rodrigues"], ["Caren", "Karen Vieira"], ["Kátia", "Cátia Brito"], ["Erika", "Érica Nunes"],
  ["Erick", "Eric Santos"], ["Monika", "Mônica Reis"], ["Rakel", "Raquel Azevedo"], ["Patric", "Patrick Gomes"], ["Caique", "Kaique Yamamoto"],
  ["Henrike Costa", "Henrique Costa"], ["Karla", "Carla Dias"], ["Luisa", "Luiza Fernandes"], ["Thereza", "Teresa Pires"], ["Izadora", "Isadora Lins"],
  ["Secília", "Cecília Andrade"], ["Gessica", "Jéssica Ribeiro"], ["Gean", "Jean Pereira"], ["Jeovana", "Geovana Prado"], ["Jisele", "Gisele Moraes"],
  ["Chavier", "Xavier Lopes"], ["Xirlei", "Shirley Matos"], ["Joaquin", "Joaquim Neves"], ["Stela", "Estela Rangel"], ["Stefany", "Stephanie Lima"],
  ["Ester", "Esther Campos"], ["Neuza", "Neusa Oliveira"], ["Welington", "Wellington Dias"], ["Vilson", "Wilson Barros"], ["Oswaldo", "Osvaldo Ramos"],
  ["Sueli", "Suely Nascimento"], ["Maiara", "Mayara Teles"], ["Suellen", "Suelen Alves"], ["Allan", "Alan Rocha"], ["Jefferson", "Jeferson Lima"],
  ["Rebecca", "Rebeca Souza"], ["Emmanuel", "Emanuel Costa"], ["Priscilla", "Priscila Gomes"], ["Camilla", "Camila Duarte"], ["Marcella", "Marcela Pinto"],
  ["Valter Assunsão", "Valter Assunção"], ["Isabella Matos", "Isabela Mattos"], ["Tiago Mendes", "Thiago Mendes"], ["Thaís Rocha", "Thaís Rocha"],
];

describe("one sound, another spelling", () => {
  it.each(SAME)("%s = %s", (a, b) => expect(phoneticToken(a)).toBe(phoneticToken(b)));
});
describe("different people are never one key", () => {
  it.each(DIFFERENT)("%s ≠ %s", (a, b) => expect(samePhoneticName(a, b) || samePhoneticName(b, a)).toBe(false));
});
describe("similar names are suggested, never taken alone", () => {
  it.each(SIMILAR)("%s → %s (suggestion)", (said, name) => {
    const ranked = rankNameSuggestions(said, [{ id: "target", name }, { id: "other", name: "Wagner Pinto" }, { id: "other2", name: "Lena Rocha" }]);
    expect(ranked.status === "SUGGEST" && ranked.rows.map(row => row.id)).toEqual(["target"]);
    expect(samePhoneticName(said, name)).toBe(false);
  });
});
describe("a realistic directory: every spoken variant finds exactly its person", () => {
  it.each(SPOKEN)("%s → %s", (said, person) => {
    const sound = DIRECTORY.filter(name => samePhoneticName(said, name));
    expect(sound).toEqual([person]);
    const ranked = rankNameSuggestions(said, DIRECTORY.map((name, i) => ({ id: String(i), name })));
    expect(ranked.status === "SUGGEST" && ranked.rows.map(row => DIRECTORY[Number(row.id)])[0]).toBe(person);
  });
  it("no two people of the directory share a full sound key", () => {
    const keys = new Map<string, string>();
    for (const name of DIRECTORY) {
      const key = name.split(/\s+/).map(phoneticToken).join(" ");
      expect(keys.get(key), `${name} vs ${keys.get(key)}`).toBeUndefined();
      keys.set(key, name);
    }
  });
  it("a first name shared by two people is never taken alone (the card asks)", () => {
    expect(DIRECTORY.filter(name => samePhoneticName("Valter", name))).toHaveLength(1);
    const two = [...DIRECTORY, "Walter Pires"];
    expect(two.filter(name => samePhoneticName("Valter", name))).toHaveLength(2);
  });
});

/** Services: the same map for a typical salon catalog (typos, voice and spelling variants). */
const SERVICES = [
  "Corte feminino", "Corte masculino", "Corte infantil", "Escova", "Escova progressiva", "Escova modelada", "Hidratação capilar", "Cauterização",
  "Coloração", "Luzes", "Mechas", "Balayage", "Selagem", "Botox capilar", "Alisamento", "Reconstrução", "Penteado", "Maquiagem", "Manicure",
  "Pedicure", "Manicure + Pedicure", "Unhas em gel", "Esmaltação em gel", "Design de sobrancelha", "Sobrancelha com henna", "Depilação a cera",
  "Depilação a laser", "Limpeza de pele", "Massagem relaxante", "Drenagem linfática", "Barba", "Barboterapia", "Pezinho", "Relaxamento",
  "Tratamento de queratina", "Spa dos pés", "Extensão de cílios", "Lash lifting", "Micropigmentação", "Peeling",
];
const SERVICE_SOUND: [string, string][] = [
  ["Idratação capilar", "Hidratação capilar"], ["Hidratassão capilar", "Hidratação capilar"], ["Cauterisação", "Cauterização"], ["Coloracao", "Coloração"],
  ["Luses", "Luzes"], ["Mexas", "Mechas"], ["Celagem", "Selagem"], ["Alizamento", "Alisamento"], ["Reconstrucao", "Reconstrução"],
  ["Escova progresiva", "Escova progressiva"], ["Depilasão a cera", "Depilação a cera"], ["Limpesa de pele", "Limpeza de pele"],
  ["Massagem relachante", "Massagem relaxante"], ["Drenajem linfática", "Drenagem linfática"], ["Tratamento de keratina", "Tratamento de queratina"],
  ["Extenção de cílios", "Extensão de cílios"], ["Micropigmentassão", "Micropigmentação"],
];
const SERVICE_SIMILAR: [string, string][] = [
  ["Sombrancelha com henna", "Sobrancelha com henna"], ["Manicuri", "Manicure"], ["Pentiado", "Penteado"], ["Unha em gel", "Unhas em gel"],
  ["Maquiajem", "Maquiagem"], ["Balaiagem", "Balayage"], ["Relachamento", "Relaxamento"],
];
describe("service names: one sound, exactly one service of the catalog", () => {
  it.each(SERVICE_SOUND)("%s → %s", (said, service) => {
    expect(SERVICES.filter(name => samePhoneticName(said, name))).toEqual([service]);
  });
  it.each(SERVICE_SIMILAR)("%s → %s (suggestion first)", (said, service) => {
    const ranked = rankNameSuggestions(said, SERVICES.map((name, i) => ({ id: String(i), name })));
    expect(ranked.status === "SUGGEST" && SERVICES[Number(ranked.rows[0].id)]).toBe(service);
  });
  it("no two services of the catalog share a sound key", () => {
    const keys = SERVICES.map(name => name.split(/\s+/).map(phoneticToken).join(" "));
    expect(new Set(keys).size).toBe(SERVICES.length);
  });
});
