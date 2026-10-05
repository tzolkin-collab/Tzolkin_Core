// Configurações → Auditoria: o que mudou, por quem e quando. Sem valores e sem detalhes: só o tipo, a pessoa e o lugar.
const no = (tag, texto, classe) => {
 const e = document.createElement(tag);
 if (texto !== undefined) e.textContent = texto;
 if (classe) e.className = classe;
 return e;
};
const quando = iso => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };

const NOMES = {
 'credencial.definida': 'Credencial de integração definida',
 'credencial.removida': 'Credencial de integração removida',
 'conta.criada': 'Conta criada',
 'conta.alterada': 'Conta alterada',
 'time.salvo': 'Time salvo',
 'sessoes.encerradas': 'Outras sessões encerradas',
};
/** "engagement.created" -> o próprio tipo, legível; os que o Core conhece ganham nome em português. */
export const nomeDoTipo = tipo => NOMES[tipo] ?? tipo;

export function montar(raiz, { api }) {
 const corpo = no('div', undefined, 'cfg-auditoria');
 raiz.append(corpo);
 (async () => {
  let d;
  try { d = await api('/api/audit?limite=100'); } catch (e) { corpo.append(no('p', e.message, 'config-ajuda')); return; }
  corpo.append(no('p', `Os ${d.itens.length} registros mais recentes, de mais novo para mais antigo.`, 'config-ajuda cfg-resumo'));
  if (!d.itens.length) corpo.append(no('p', 'Nada registrado ainda.', 'config-ajuda'));
  const lista = no('div', undefined, 'cfg-lista');
  for (const i of d.itens) {
   const l = no('div', undefined, 'cfg-linha cfg-registro'); l.dataset.fonte = i.fonte;
   const t = no('div', undefined, 'cfg-linha-texto');
   t.append(no('strong', nomeDoTipo(i.tipo)), no('small', [i.quem || 'sistema', i.onde].filter(Boolean).join(' · ')));
   if (i.resumo) t.append(no('small', i.resumo, 'cfg-resumo-registro'));
   l.append(t, no('span', quando(i.quando), 'cfg-valor'));
   lista.append(l);
  }
  corpo.append(lista);
  if ((d.fora_da_trilha || []).length) corpo.append(no('p', `Ainda não entram aqui: ${d.fora_da_trilha.join(', ')}.`, 'cfg-nota'));
 })();
}
