// Configurações → Acessos: quem pode entrar no Core e com que papel. Só o administrador altera (o servidor também exige).
// Quem entra pela lista do servidor (CORE_ALLOWED_EMAILS) NÃO se suspende por aqui, e a tela diz isso em vez de fingir que o botão resolve.
import { selo } from './data-table.js';

const no = (tag, texto, classe) => {
 const e = document.createElement(tag);
 if (texto !== undefined) e.textContent = texto;
 if (classe) e.className = classe;
 return e;
};
const PAPEIS = [['owner', 'Administrador'], ['member', 'Membro'], ['viewer', 'Leitor']];
const SITUACOES = [['active', 'Ativa'], ['suspended', 'Suspensa']];
const rotulo = (lista, v) => lista.find(([k]) => k === v)?.[1] ?? v;

function seletor(nome, opcoes, atual) {
 const s = document.createElement('select'); s.name = nome;
 for (const [v, t] of opcoes) { const o = no('option', t); o.value = v; s.append(o); }
 s.value = atual;
 return s;
}

export function montar(raiz, { api }) {
 const corpo = no('div', undefined, 'cfg-acessos');
 const aviso = no('p', '', 'config-aviso'); aviso.setAttribute('role', 'status');
 raiz.append(corpo, aviso);
 const dizer = (texto, erro = false) => { aviso.textContent = texto; aviso.classList.toggle('erro', erro); };

 async function gravar(conta) {
  await api('/api/accounts', 'PUT', conta);
  dizer(`Salvo: ${conta.email}.`);
  await desenhar();
 }

 async function desenhar() {
  let dados, eu;
  try { [dados, eu] = await Promise.all([api('/api/accounts'), api('/api/me')]); } catch (e) { corpo.replaceChildren(no('p', e.message, 'config-ajuda')); return; }
  const admin = eu.pode_administrar === true;
  const nos = [];
  const a = dados.authorization || {};
  nos.push(no('p', `${a.effective ?? dados.accounts.length} ${a.effective === 1 ? 'pessoa pode' : 'pessoas podem'} entrar hoje: a lista do servidor (${a.env_count ?? 0}) somada às contas ativas abaixo (${a.registry_count ?? 0}).`, 'config-ajuda cfg-resumo'));
  if (!admin) nos.push(no('p', 'Só administradores alteram contas. Você pode ver a lista.', 'config-ajuda cfg-sem-permissao'));

  const lista = no('div', undefined, 'cfg-lista');
  if (!dados.accounts.length) lista.append(no('p', 'Nenhuma conta cadastrada ainda: entram só as pessoas da lista do servidor.', 'config-ajuda'));
  for (const c of dados.accounts) {
   const l = no('div', undefined, 'cfg-linha cfg-conta'); l.dataset.email = c.email;
   const t = no('div', undefined, 'cfg-linha-texto');
   const topo = no('div', undefined, 'cfg-integracao-topo');
   topo.append(no('strong', c.name || c.email), selo(rotulo(PAPEIS, c.role), c.role === 'owner' ? 'accent' : 'neutral'), selo(rotulo(SITUACOES, c.status), c.status === 'active' ? 'success' : 'warning'));
   t.append(topo);
   if (c.name) t.append(no('small', c.email));
   l.append(t);
   if (admin) {
    const papel = seletor('role', PAPEIS, c.role), situacao = seletor('status', SITUACOES, c.status);
    papel.setAttribute('aria-label', `Papel de ${c.email}`); situacao.setAttribute('aria-label', `Situação de ${c.email}`);
    const salvar = no('button', 'Salvar', 'secondary'); salvar.type = 'button';
    salvar.onclick = async () => { salvar.disabled = true; try { await gravar({ email: c.email, name: c.name, role: papel.value, status: situacao.value }); } catch (e) { dizer(e.message, true); salvar.disabled = false; } };
    const acoes = no('div', undefined, 'cfg-conta-acoes'); acoes.append(papel, situacao, salvar);
    l.append(acoes);
   }
   lista.append(l);
  }
  nos.push(lista);

  if ((a.env_only || []).length) {
   const n = no('div', undefined, 'cfg-nota');
   n.append(no('strong', 'Entram pela lista do servidor'), no('p', `${a.env_only.join(', ')}. Estes endereços não aparecem como conta e não se suspendem por aqui: para tirar o acesso é preciso editar CORE_ALLOWED_EMAILS no servidor. Cadastrar uma conta para eles dá um papel (por exemplo, Membro).`));
   nos.push(n);
  }

  if (admin) {
   const f = no('form', undefined, 'cfg-cred-form'); f.noValidate = true;
   f.append(no('h3', 'Adicionar ou alterar uma conta', 'config-sub'));
   const campo = (rot, nome, tipo = 'text') => { const l = no('label', undefined, 'cfg-cred-campo'); l.append(no('span', rot)); const i = document.createElement('input'); i.name = nome; i.type = tipo; i.autocomplete = 'off'; l.append(i); f.append(l); return i; };
   const email = campo('E-mail (o da conta Google)', 'email', 'email'); email.required = true;
   const nome = campo('Nome (opcional)', 'name');
   const lp = no('label', undefined, 'cfg-seletor'); lp.append(no('span', 'Papel')); const papel = seletor('role', PAPEIS, 'member'); lp.append(papel); f.append(lp);
   const acoes = no('div', undefined, 'config-acoes'); const salvar = no('button', 'Salvar conta', 'primary'); salvar.type = 'submit'; acoes.append(salvar); f.append(acoes);
   f.onsubmit = async ev => {
    ev.preventDefault();
    if (!email.value.trim()) { dizer('Informe o e-mail.', true); return; }
    salvar.disabled = true;
    try { await gravar({ email: email.value.trim(), ...(nome.value.trim() ? { name: nome.value.trim() } : {}), role: papel.value, status: 'active' }); }
    catch (e) { dizer(e.message, true); salvar.disabled = false; }
   };
   nos.push(f);
  }
  corpo.replaceChildren(...nos);
 }
 desenhar();
}
