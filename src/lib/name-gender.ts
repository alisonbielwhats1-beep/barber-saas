/**
 * Estimativa de gênero a partir do primeiro nome, usada apenas como
 * fallback quando ClientProfile.gender não foi informado manualmente.
 * Nunca sobrescreve uma escolha explícita — só preenche o que está em branco.
 *
 * Cobertura: lista curada dos nomes mais comuns no Brasil. Nomes raros,
 * estrangeiros ou ambíguos (ex.: "Alex", "Noel") não são classificados e
 * continuam null — é preferível não informar a informar errado.
 */

const FEMALE_FIRST_NAMES = new Set([
  "maria","ana","francisca","antonia","adriana","juliana","marcia","fernanda","patricia","aline",
  "sandra","camila","amanda","bruna","jessica","leticia","julia","luciana","vanessa","mariana",
  "gabriela","valentina","beatriz","yasmin","isabela","larissa","rafaela","daniela","carolina","renata",
  "cristina","denise","regina","sonia","vera","rosa","rosangela","roberta","simone","silvia",
  "silvana","solange","tatiana","tania","tereza","vania","viviane","vivian","vívian","wanessa",
  "priscila","poliana","paula","natalia","nathalia","nayara","monique","michele","michelle","melissa",
  "marina","marta","milena","luana","luiza","luisa","livia","lorena","laura","lais",
  "karina","karen","katia","kelly","jaqueline","jacqueline","janaina","joana","joyce","andressa",
  "andreia","alessandra","angela","angelica","aparecida","bianca","barbara","carla","catia","celia",
  "claudia","cintia","cinthia","debora","edna","elaine","elenice","elisangela","eliane","elizabeth",
  "eloisa","erica","estela","estefania","eva","fabiana","flavia","gislaine","giovanna","girlene",
  "gabrielly","grazielle","graziela","helen","helena","ines","iracema","irene","ivone","ivanete",
  "jane","janete","jaciara","jandira","jussara","karla","kamila","lidia","lilian","liliane",
  "lindalva","lorraine","lucia","lucimar","lucilene","lucineia","luzia","magda","manuela","manoela",
  "marcela","margarete","margarida","marilene","marilia","marisa","marlene","mayara","meire","mirian",
  "miriam","nadia","nair","neide","neusa","nilza","noemi","odete","olivia","pamela",
  "paloma","pietra","rebeca","rita","rosemeire","rosemary","rosilene","rute","sabrina","samara",
  "selma","shirley","silmara","sirlene","stela","stephanie","suellen","suzana","tais","talita",
  "thais","thalita","thamires","valdirene","valeria","vanda","veronica","wilma","yara","ariane",
  "alice","agatha","alicia","antonella","cecilia","clara","emanuelly","emilly","esther","heloisa",
  "isadora","maite","melina","nicole","sara","sophia","sophie","vitoria","zoe","raquel",
  "rosana","sara","sueli","susana","telma","valquiria","zenaide","zilda","zuleide","zulmira",
]);

const MALE_FIRST_NAMES = new Set([
  "jose","joao","antonio","francisco","carlos","paulo","pedro","lucas","luiz","marcos",
  "luis","gabriel","rafael","daniel","marcelo","bruno","eduardo","felipe","rodrigo","fernando",
  "diego","leonardo","ricardo","andre","vinicius","alexandre","anderson","alessandro","renato","marcio",
  "sergio","roberto","fabio","fabricio","adriano","wesley","wagner","gustavo","guilherme","henrique",
  "igor","jorge","julio","leandro","mauricio","nelson","vitor","victor","thiago","tiago",
  "william","wellington","cesar","claudio","cristiano","danilo","denis","dennis","douglas","edson",
  "elias","emerson","erick","eric","everton","ezequiel","fabiano","flavio","gilberto","gilson",
  "hugo","ivan","jair","jonathan","jonas","josue","juliano","junior","lauro","lucio",
  "luciano","manoel","marco","mario","matheus","milton","moacir","murilo","nathan","nicolas",
  "nilton","osvaldo","otavio","pablo","patrick","rangel","raul","renan","reginaldo","reinaldo",
  "rene","ronaldo","rubens","samuel","sandro","silvio","tadeu","tarcisio","valdir","valter",
  "walter","vagner","wanderson","weslei","yago","yuri","alison","alisson","arthur","artur",
  "benjamin","benicio","bento","caio","cauã","caua","davi","david","enzo","enrico",
  "erik","gael","heitor","ian","isaac","ivo","joaquim","kevin","leonel","lorenzo",
  "miguel","noah","otto","pietro","rian","ryan","theo","theodoro","yan","bernardo",
  "geraldo","hamilton","helio","hercules","irineu","israel","ismael","ivair","jacson","jackson",
  "jeferson","jefferson","joel","jonatas","jose","juarez","laercio","levi","lindomar","lindberg",
  "marcelino","natanael","nivaldo","norberto","oswaldo","raimundo","robson","rogerio","romario","romulo",
  "salomao","sidnei","sidney","valmir","vanderlei","vitorio","waldemar","wallace","warley","zacarias",
]);

function normalizeFirstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function inferGenderFromName(fullName: string | null | undefined): "MALE" | "FEMALE" | null {
  if (!fullName) return null;
  const key = normalizeFirstName(fullName);
  if (!key) return null;
  if (FEMALE_FIRST_NAMES.has(key)) return "FEMALE";
  if (MALE_FIRST_NAMES.has(key)) return "MALE";
  return null;
}
