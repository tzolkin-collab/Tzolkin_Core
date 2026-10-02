// Peças do formulário de espaço do portfólio: o identificador que nasce do nome e o
// campo de tags em chips. As regras espelham as do servidor (portfolio.mjs): o servidor
// é quem valida de verdade; aqui só se evita mandar o que ele vai recusar.

/** "Assessoria de Marca & Design" → "assessoria-de-marca-design": o identificador sugerido. */
export function slugDoNome(nome) {
 const base = String(nome || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
 // O identificador começa com letra (ADR do portfólio) e cabe em 64 caracteres.
 return base.replace(/^[^a-z]+/, '').slice(0, 64).replace(/-+$/g, '');
}

/** Uma tag como o servidor a guarda: minúscula, sem espaços, só letras, números e hífen. */
export function normalizarTag(texto) {
 return String(texto || '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 30);
}

export const MAX_TAGS = 8;

/**
 * Campo de tags em chips. Enter ou vírgula adiciona; Backspace no campo vazio remove a
 * última; cada chip tem o próprio botão de remover. O valor vai para um input oculto,
 * separado por vírgula, que é o formato que o formulário já envia ao servidor.
 */
export function mountTagInput({ box, input, hidden, max = MAX_TAGS }) {
 let tags = [];
 const el = (tag, classe, texto) => { const n = document.createElement(tag); if (classe) n.className = classe; if (texto !== undefined) n.textContent = texto; return n; };
 const pintar = () => {
  for (const chip of [...box.querySelectorAll('.tag-chip')]) chip.remove();
  for (const tag of tags) {
   const chip = el('span', 'tag-chip', tag);
   const remover = el('button', 'tag-remove', '×'); remover.type = 'button'; remover.setAttribute('aria-label', `Remover a tag ${tag}`);
   remover.onclick = () => { tags = tags.filter(item => item !== tag); pintar(); input.focus(); };
   chip.append(remover); box.insertBefore(chip, input);
  }
  hidden.value = tags.join(', ');
  input.placeholder = tags.length ? '' : input.dataset.placeholder || '';
  input.disabled = tags.length >= max;
 };
 const adicionar = texto => {
  const tag = normalizarTag(texto);
  if (tag.length >= 2 && !tags.includes(tag) && tags.length < max) { tags.push(tag); pintar(); }
  input.value = '';
 };
 input.onkeydown = evento => {
  if (evento.key === 'Enter' || evento.key === ',') { evento.preventDefault(); if (input.value.trim()) adicionar(input.value); }
  else if (evento.key === 'Backspace' && !input.value && tags.length) { tags.pop(); pintar(); }
 };
 input.onblur = () => { if (input.value.trim()) adicionar(input.value); };
 // Colar "a, b, c" vira três chips.
 input.onpaste = evento => {
  const texto = evento.clipboardData?.getData('text') || '';
  if (!/[,\n]/.test(texto)) return;
  evento.preventDefault(); texto.split(/[,\n]/).forEach(adicionar);
 };
 box.onclick = evento => { if (evento.target === box) input.focus(); };
 pintar();
 return {
  set(lista) { tags = [...new Set((lista || []).map(normalizarTag).filter(tag => tag.length >= 2))].slice(0, max); pintar(); },
  get: () => [...tags],
 };
}
