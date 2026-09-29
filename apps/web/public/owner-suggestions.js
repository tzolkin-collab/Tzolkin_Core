// Sugestão de dono para um recurso do inventário (repositório, projeto da Vercel,
// serviço do EasyPanel).
//
// SÓ SUGERE. Quem vincula é o operador, com um clique: a heurística por nome foi
// exatamente o que a migração 034 aposentou como fonte de verdade, porque um nome
// parecido herdava o dono de outro. Aqui ela volta com outro papel: dizer, com o
// motivo escrito, "isto provavelmente é do Kalidash", e deixar a decisão com quem
// sabe. Nada aqui grava nada nem chama a API.
//
// Duas fontes, da mais forte para a mais fraca:
//   1. EVIDÊNCIA — a Vercel diz de qual repositório cada projeto sai. Um repositório
//      de que sai um projeto já classificado herda o dono dele, e vice-versa: é o
//      caso do monorepo, em que um repositório reúne várias partes.
//   2. NOME — um termo distintivo do recurso (kalidash) que também está no nome do
//      dono (contratação, empresa ou item do portfólio). Se dois donos combinam, não
//      há sugestão: há uma ambiguidade, e ela é dita.
//
// O EasyPanel não informa de qual repositório um serviço sai (o inventário não traz
// a origem), então para ele só existe a segunda fonte.

/** Termos que aparecem em quase todo nome e, por isso, não distinguem ninguém. */
const GENERICOS = new Set([
 'site', 'sites', 'landing', 'landingpage', 'page', 'pages', 'evento', 'event', 'app', 'apps', 'web', 'front', 'frontend',
 'back', 'backend', 'api', 'worker', 'main', 'master', 'prod', 'production', 'staging', 'teste', 'test', 'projeto', 'project',
 'tzolkin', 'collab', 'other', 'core', 'proposta', 'template', 'sistema', 'servico', 'servicos', 'contratacao',
 'demanda', 'cliente', 'clientes', 'empresa', 'mentoria', 'consultoria', 'assessoria',
]);

const semAcento = texto => String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Como a contratação se chama, em uma palavra. */
export const MODELOS = { on_demand: 'sob demanda', education: 'mentoria', consulting: 'consultoria', advisory: 'assessoria', product: 'produto', unclassified: 'a classificar' };

/**
 * O nome de um dono, sem repetir o que o próprio nome já diz. Um rótulo como
 * "Kalidash sob demanda" não ganha outro "· sob demanda", e "Kalidash — site" não
 * ganha o nome da empresa de novo. Só entra o que o rótulo não traz.
 */
export function nomeDoDono({ label, cliente, modelo }) {
 const base = semAcento(label);
 const partes = [];
 if (cliente && !base.includes(semAcento(cliente))) partes.push(cliente);
 const palavra = MODELOS[modelo];
 if (palavra && !semAcento(palavra).split(' ').some(termo => termo.length >= 5 && base.includes(termo))) partes.push(palavra);
 return [label, ...partes].join(' · ');
}

/** Termos distintivos de um texto: 4+ letras, não numéricos, fora da lista de genéricos. */
export const termos = texto => [...new Set(semAcento(texto).split(/[^a-z0-9]+/)
 .filter(termo => termo.length >= 4 && !/^\d+$/.test(termo) && !GENERICOS.has(termo)))];

/** O nome do repositório sem a organização: "tzolkin-collab/Kalidash_Site" → "Kalidash_Site". */
const nomeCurto = recurso => recurso.provider === 'github' ? String(recurso.name).split('/').slice(1).join('/') : String(recurso.name);

/** O inventário que /api/delivery/options devolve, achatado numa lista só. */
export const achatar = inventario => ['github', 'vercel', 'easypanel'].flatMap(provider => {
 const bloco = inventario?.[provider];
 return bloco?.status === 'ok'
  ? bloco.items.map(item => ({ provider, id: item.id, name: item.name, repository: item.repository || null }))
  : [];
});

const mesmoRepo = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();

export const chaveDono = dono => dono.product_id ? `product:${dono.product_id}` : `engagement:${dono.engagement_id}`;

/**
 * Quem já é dono de um recurso, se alguma conexão ativa o reclama.
 * `casa` é o casamento conexão↔recurso do painel (casaConexao): é passado, e não
 * reescrito aqui, para haver uma só regra sobre o que "é o mesmo recurso".
 */
const donoAtivoDe = (recurso, conexoes, casa) => {
 const conexao = conexoes.find(item => item.active !== false && casa(item, recurso));
 return conexao ? { product_id: conexao.product_id || null, engagement_id: conexao.engagement_id || null } : null;
};

/** Palavras que estão em quase todo recurso da casa e nunca identificam um item ("Educare by TZOLKIN"). */
const PALAVRAS_DA_CASA = new Set(['tzolkin', 'collab', 'other']);

/** Todos os termos de 4+ letras, sem filtro de genéricos: a base do casamento exato de um item. */
const brutos = texto => [...new Set(semAcento(texto).split(/[^a-z0-9]+/).filter(termo => termo.length >= 4 && !/^\d+$/.test(termo)))];

/** Os donos possíveis, cada um com o texto pelo qual pode ser reconhecido. */
export const candidatos = donos => {
 const empresa = id => donos.tenants?.find(item => item.id === id) || null;
 return [
  ...(donos.engagements || []).filter(item => !item.archived_at).map(item => {
   const cliente = empresa(item.tenant_id);
   return {
    dono: { product_id: null, engagement_id: item.id },
    rotulo: nomeDoDono({ label: item.label, cliente: cliente?.name, modelo: item.service_model }),
    modelo: item.service_model || null,
    termos: termos(`${item.label} ${cliente?.name || ''}`),
   };
  }),
  ...(donos.products || []).map(item => ({
   dono: { product_id: item.id, engagement_id: null },
   rotulo: item.name, modelo: null, termos: termos(`${item.name} ${item.id}`),
   // O id e o nome do item, mesmo quando são palavras comuns ("core", "sites"): um
   // item se reconhece pelo próprio nome. Vale só para item, nunca para contratação.
   exatos: brutos(`${item.name} ${item.id}`).filter(termo => !PALAVRAS_DA_CASA.has(termo)),
  })),
 ];
};

/** Repositório de onde o recurso sai, quando o provedor diz. */
const repositorioDe = (recurso, itens) => {
 if (recurso.provider === 'vercel') return recurso.repository || null;
 if (recurso.provider === 'github') return itens.find(item => item.provider === 'github' && item.id === recurso.id)?.name || recurso.name;
 return null;
};

/**
 * Os outros recursos do inventário que saem do mesmo repositório e ainda não têm
 * dono — o monorepo. Para um repositório são os projetos da Vercel dele; para um
 * projeto da Vercel são o repositório e os projetos irmãos.
 */
export function irmaosDoRepositorio(recurso, { itens, conexoes, casa }) {
 const repo = repositorioDe(recurso, itens);
 if (!repo) return [];
 return itens.filter(item => item.provider !== 'easypanel'
  && !(item.provider === recurso.provider && item.id === recurso.id)
  && (item.provider === 'github' ? mesmoRepo(item.name, repo) : mesmoRepo(item.repository, repo))
  && !donoAtivoDe(item, conexoes, casa));
}

/**
 * Sugestão de dono para um recurso sem dono.
 * Devolve `{ dono, rotulo, modelo, motivo, evidencia }`, ou `{ ambiguo: [rótulos] }`
 * quando o nome combina com mais de um dono, ou `null` quando não há nada a dizer.
 */
export function sugerirDono(recurso, { itens, conexoes, donos, casa }) {
 // 1. Evidência: o repositório liga o recurso a algo que já tem dono.
 const repo = repositorioDe(recurso, itens);
 if (repo) {
  const parentes = itens.filter(item => item.provider !== 'easypanel'
   && !(item.provider === recurso.provider && item.id === recurso.id)
   && (item.provider === 'github' ? mesmoRepo(item.name, repo) : mesmoRepo(item.repository, repo)));
  const porDono = new Map();
  for (const parente of parentes) {
   const dono = donoAtivoDe(parente, conexoes, casa);
   if (dono) porDono.set(chaveDono(dono), { dono, parente });
  }
  if (porDono.size === 1) {
   const [{ dono, parente }] = porDono.values();
   const candidato = candidatos(donos).find(item => chaveDono(item.dono) === chaveDono(dono));
   return {
    dono, rotulo: candidato?.rotulo || 'Dono já registrado', modelo: candidato?.modelo || null, evidencia: 'repositorio', etiqueta: 'mesmo repositório',
    motivo: recurso.provider === 'github'
     ? `o projeto «${parente.name}» da Vercel sai deste repositório e já pertence a este dono`
     : `${parente.provider === 'github' ? 'o repositório' : 'o projeto'} «${parente.name}» é da mesma origem e já pertence a este dono`,
   };
  }
  if (porDono.size > 1) return { ambiguo: [...porDono.values()].map(({ dono }) => candidatos(donos).find(item => chaveDono(item.dono) === chaveDono(dono))?.rotulo || 'Dono') };
 }

 // 2. Nome: um termo distintivo do recurso também presente no nome de um dono.
 const meus = termos(nomeCurto(recurso)), crus = brutos(nomeCurto(recurso));
 if (!meus.length && !crus.length) return null;
 const achados = candidatos(donos).map(candidato => ({
  candidato,
  comuns: [...candidato.termos.filter(termo => meus.includes(termo)), ...(candidato.exatos || []).filter(termo => crus.includes(termo) && !meus.includes(termo))],
 })).filter(item => item.comuns.length);
 if (!achados.length) return null;
 // Uma empresa com duas contratações combina duas vezes com o mesmo termo: isso é
 // ambiguidade de verdade, e a sugestão errada custa mais do que nenhuma.
 if (achados.length > 1) return { ambiguo: achados.map(item => item.candidato.rotulo) };
 const [{ candidato, comuns }] = achados;
 return { dono: candidato.dono, rotulo: candidato.rotulo, modelo: candidato.modelo, evidencia: 'nome', etiqueta: `nome «${comuns[0]}»`,
  motivo: `o nome tem «${comuns[0]}», que também está no nome deste dono` };
}

/**
 * As sugestões reunidas por dono sugerido: é o que a tela mostra, porque um
 * repositório e os projetos que saem dele têm de ser vinculados juntos. Cada grupo
 * traz os recursos com o motivo de cada um; os irmãos do mesmo repositório entram
 * mesmo quando o nome deles não diria nada.
 *   grupos     — um dono sugerido, N recursos
 *   ambiguos   — o nome combina com mais de um dono: o operador escolhe
 *   restantes  — sem pista nenhuma
 */
export function agruparSugestoes(semDono, contexto) {
 const grupos = new Map(), ambiguos = [], usados = new Set();
 const id = recurso => `${recurso.provider}:${recurso.id}`;
 for (const recurso of semDono) {
  const sugestao = sugerirDono(recurso, contexto);
  if (sugestao?.dono) {
   const chave = chaveDono(sugestao.dono);
   const grupo = grupos.get(chave) || { chave, dono: sugestao.dono, rotulo: sugestao.rotulo, modelo: sugestao.modelo, recursos: [] };
   grupo.recursos.push({ recurso, motivo: sugestao.motivo, evidencia: sugestao.evidencia, etiqueta: sugestao.etiqueta });
   grupos.set(chave, grupo); usados.add(id(recurso));
  } else if (sugestao?.ambiguo) { ambiguos.push({ recurso, candidatos: sugestao.ambiguo }); usados.add(id(recurso)); }
 }
 for (const grupo of grupos.values()) {
  for (const { recurso } of [...grupo.recursos]) {
   for (const irmao of irmaosDoRepositorio(recurso, contexto)) {
    if (usados.has(id(irmao))) continue;
    grupo.recursos.push({ recurso: irmao, motivo: `sai do mesmo repositório que «${recurso.name}»`, evidencia: 'repositorio', etiqueta: 'mesmo repositório' });
    usados.add(id(irmao));
   }
  }
 }
 return {
  grupos: [...grupos.values()].sort((a, b) => b.recursos.length - a.recursos.length || a.rotulo.localeCompare(b.rotulo)),
  ambiguos, restantes: semDono.filter(recurso => !usados.has(id(recurso))),
 };
}
