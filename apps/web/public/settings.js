// Configurações: por enquanto só a aparência. O tema vive em theme-boot.js (window.TzolkinTema), que roda antes
// do CSS; aqui só se escolhe. A escolha é deste navegador, não da conta.
const OPCOES = [
 ['sistema', 'Seguir o sistema', 'Claro ou escuro, como o seu aparelho estiver.'],
 ['claro', 'Claro', 'Fundo branco.'],
 ['escuro', 'Escuro', 'Fundo cinza-escuro, mais calmo para trabalhar à noite.'],
];

const no = (tag, texto, classe) => {
 const e = document.createElement(tag);
 if (texto !== undefined) e.textContent = texto;
 if (classe) e.className = classe;
 return e;
};

export function montarConfiguracoes(raiz) {
 const tema = window.TzolkinTema;
 const atual = tema ? tema.preferencia() : 'sistema';
 const grupo = no('fieldset', undefined, 'config-grupo');
 grupo.append(no('legend', 'Aparência', 'config-titulo'));
 grupo.append(no('p', 'Vale só para este navegador.', 'config-ajuda'));
 for (const [valor, titulo, ajuda] of OPCOES) {
  const rotulo = no('label', undefined, 'config-opcao');
  const radio = document.createElement('input');
  radio.type = 'radio'; radio.name = 'tema'; radio.value = valor; radio.checked = valor === atual;
  radio.onchange = () => { if (radio.checked && tema) tema.definir(valor); };
  const texto = no('span', undefined, 'config-opcao-texto');
  texto.append(no('strong', titulo), no('small', ajuda));
  rotulo.append(radio, texto);
  grupo.append(rotulo);
 }
 raiz.replaceChildren(grupo);
}
