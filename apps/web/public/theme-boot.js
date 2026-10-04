/* Tema: claro, escuro ou "sistema" (padrão). Roda no <head>, antes do CSS pintar, para não piscar branco.
   Escreve <html data-theme="light|dark"> (o que o CSS lê) e data-theme-pref="sistema|claro|escuro" (o que a
   pessoa escolheu). A escolha fica só neste navegador (localStorage). Script clássico, sem módulo, por causa
   do carregamento síncrono; a CSP do Core só aceita scripts do próprio domínio, por isso é um arquivo. */
(function () {
  var CHAVE = 'tzolkin-tema';
  var raiz = document.documentElement;
  var escuro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var COR_DA_BARRA = { light: '#ffffff', dark: '#111111' };

  function preferencia() {
    try { var v = localStorage.getItem(CHAVE); return v === 'claro' || v === 'escuro' ? v : 'sistema'; }
    catch (erro) { return 'sistema'; }
  }
  function aplicar() {
    var pref = preferencia();
    var tema = pref === 'escuro' || (pref === 'sistema' && escuro && escuro.matches) ? 'dark' : 'light';
    raiz.setAttribute('data-theme', tema);
    raiz.setAttribute('data-theme-pref', pref);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COR_DA_BARRA[tema]);
  }
  function definir(pref) {
    try {
      if (pref === 'claro' || pref === 'escuro') localStorage.setItem(CHAVE, pref);
      else localStorage.removeItem(CHAVE);
    } catch (erro) { /* navegação privada: vale só até recarregar */ }
    aplicar();
  }

  window.TzolkinTema = { preferencia: preferencia, definir: definir, aplicar: aplicar };
  if (escuro) {
    if (escuro.addEventListener) escuro.addEventListener('change', aplicar);
    else if (escuro.addListener) escuro.addListener(aplicar);
  }
  aplicar();
})();
