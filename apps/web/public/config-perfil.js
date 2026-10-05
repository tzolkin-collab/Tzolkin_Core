// Configurações → Perfil e sessão. Quem está logado, o que pode fazer e até quando vale o acesso. Nenhum token chega à tela.
const no = (tag, texto, classe) => {
 const e = document.createElement(tag);
 if (texto !== undefined) e.textContent = texto;
 if (classe) e.className = classe;
 return e;
};
const quando = iso => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };

const PAPEIS = {
 owner: 'Administra o Core: gerencia quem entra e altera as credenciais das integrações.',
 member: 'Usa o Core, mas não gerencia contas nem altera credenciais das integrações.',
 viewer: 'Só consulta: não gerencia contas nem altera credenciais.',
};
const ORIGENS = {
 cadastro: 'Tem conta cadastrada em Acessos.',
 ambiente: 'Entra pela lista do servidor (CORE_ALLOWED_EMAILS) e ainda não tem conta cadastrada: vale como administrador.',
 local: 'Acesso local por senha, sem conta individual.',
};

function linha(rotulo, valor, ajuda) {
 const l = no('div', undefined, 'cfg-linha');
 const t = no('div', undefined, 'cfg-linha-texto');
 t.append(no('strong', rotulo));
 if (ajuda) t.append(no('small', ajuda));
 l.append(t, typeof valor === 'string' ? no('span', valor, 'cfg-valor') : valor);
 return l;
}

export function montar(raiz, { api }) {
 const lista = no('div', undefined, 'cfg-lista');
 const aviso = no('p', '', 'config-aviso'); aviso.setAttribute('role', 'status');
 raiz.append(lista, aviso);
 const dizer = (texto, erro = false) => { aviso.textContent = texto; aviso.classList.toggle('erro', erro); };

 async function desenhar() {
  let eu;
  try { eu = await api('/api/me'); } catch (e) { lista.replaceChildren(no('p', e.message, 'config-ajuda')); return; }
  const linhas = [];
  if (eu.nome) linhas.push(linha('Nome', eu.nome));
  linhas.push(linha('E-mail', eu.email || 'Sem e-mail (acesso local)'));
  linhas.push(linha('Papel', eu.papel_rotulo, `${PAPEIS[eu.papel] || ''} ${ORIGENS[eu.origem] || ''}`.trim()));
  linhas.push(linha('Como você entrou', eu.modo === 'google' ? 'Conta Google' : 'Senha local'));

  const sair = no('button', 'Sair deste aparelho', 'secondary'); sair.type = 'button';
  sair.onclick = () => document.getElementById('logout')?.click();
  if (eu.sessao) {
   linhas.push(linha('Esta sessão', eu.sessao.expira_em ? `Vale até ${quando(eu.sessao.expira_em)}` : 'Ativa', eu.sessao.criada_em ? `Iniciada em ${quando(eu.sessao.criada_em)}.` : undefined));
   const n = eu.sessao.outras_ativas;
   const acoes = no('div', undefined, 'config-acoes');
   acoes.append(sair);
   if (n > 0) {
    const outras = no('button', `Encerrar as outras ${n === 1 ? 'sessão' : n + ' sessões'}`, 'secondary'); outras.type = 'button'; outras.dataset.acao = 'encerrar-outras';
    outras.onclick = async () => {
     outras.disabled = true;
     try { const r = await api('/api/me/sessoes/encerrar-outras', 'POST', {}); dizer(`${r.encerradas} ${r.encerradas === 1 ? 'sessão encerrada' : 'sessões encerradas'}. Esta continua valendo.`); await desenhar(); }
     catch (e) { dizer(e.message, true); outras.disabled = false; }
    };
    acoes.append(outras);
   }
   linhas.push(linha('Outras sessões', n > 0 ? `${n} ativa${n === 1 ? '' : 's'}` : 'Nenhuma', 'Sessões suas em outros aparelhos ou navegadores. Encerre se esqueceu algum aberto.'));
   lista.replaceChildren(...linhas, acoes);
  } else {
   const acoes = no('div', undefined, 'config-acoes'); acoes.append(sair);
   linhas.push(linha('Esta sessão', 'Única', 'No acesso por senha local há uma sessão só.'));
   lista.replaceChildren(...linhas, acoes);
  }
 }
 desenhar();
}
