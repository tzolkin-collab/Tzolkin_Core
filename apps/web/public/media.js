// Fotos de um registro (empresa, lead): colar, arrastar ou escolher.
//
// As fotos ficam no R2 privado. A API devolve, a cada listagem, uma URL assinada de
// poucos minutos; nada é guardado nem repetido na tela. Se a URL vencer com a aba
// aberta, a imagem falha e o painel recarrega a lista uma vez para pegar URLs novas.
//
// A imagem é reduzida AQUI, antes de subir: foto de câmera tem 4000 px e vários MB, e
// ninguém precisa disso numa ficha. PNG e WebP seguem no formato original (logo com
// transparência não pode virar JPEG); GIF sobe como veio (reduzir quebraria a animação).

export const MAX_SIDE = 2000;
export const MAX_BYTES = 8 * 1024 * 1024;

/** Lado maior limitado a `max`, mantendo a proporção. Não amplia. */
export function fitSize(width, height, max = MAX_SIDE) {
 const largest = Math.max(width, height);
 if (largest <= max) return { width, height, scaled: false };
 const ratio = max / largest;
 return { width: Math.round(width * ratio), height: Math.round(height * ratio), scaled: true };
}

const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

async function shrink(file) {
 if (file.type === 'image/gif' || !('createImageBitmap' in window)) return file;
 let bitmap;
 try { bitmap = await createImageBitmap(file); } catch { return file; }
 const size = fitSize(bitmap.width, bitmap.height);
 if (!size.scaled) { bitmap.close?.(); return file; }
 const canvas = document.createElement('canvas');
 canvas.width = size.width; canvas.height = size.height;
 canvas.getContext('2d').drawImage(bitmap, 0, 0, size.width, size.height);
 bitmap.close?.();
 const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg';
 const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.85));
 // Se não ficou menor, vale o original.
 return blob && blob.size < file.size ? blob : file;
}

async function send(owner, file) {
 if (!file.type.startsWith('image/')) throw new Error('Só imagens: JPEG, PNG, WebP ou GIF.');
 const body = await shrink(file);
 if (body.size > MAX_BYTES) throw new Error('A imagem passa de 8 MB, mesmo reduzida.');
 const query = new URLSearchParams({ owner_type: owner.type, owner_id: owner.id });
 if (file.name) query.set('name', file.name);
 const response = await fetch('/api/media?' + query, { method: 'POST', headers: { 'Content-Type': body.type || 'application/octet-stream' }, body });
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(response.status === 401 ? 'A sessão expirou. Entre de novo.' : data.message || 'Não foi possível enviar a imagem.');
 return data;
}

const typing = target => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Painel de fotos de um dono: `{ type: 'tenant' | 'lead', id }`. */
export function photoPanel(owner) {
 const root = el('div', undefined, 'photo-panel');
 const zone = el('div', 'Cole (Ctrl+V), arraste ou clique para adicionar imagens', 'photo-zone');
 zone.tabIndex = 0; zone.setAttribute('role', 'button');
 const status = el('p', undefined, 'photo-status'); status.setAttribute('role', 'status');
 const grid = el('div', undefined, 'photo-grid');
 const picker = el('input'); picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp,image/gif'; picker.multiple = true; picker.hidden = true;
 root.append(zone, picker, status, grid);

 const say = (text, bad) => { status.textContent = text || ''; status.classList.toggle('photo-error', Boolean(bad)); };
 let retried = false, busy = false;

 async function load() {
  try {
   const response = await fetch('/api/media?' + new URLSearchParams({ owner_type: owner.type, owner_id: owner.id }));
   const data = await response.json().catch(() => ({}));
   if (!response.ok) { zone.hidden = response.status === 503; say(data.message || 'Não foi possível carregar as fotos.', response.status !== 503); grid.replaceChildren(); return; }
   zone.hidden = false;
   paint(data.photos || []);
  } catch { say('Não foi possível carregar as fotos.', true); }
 }

 function paint(photos) {
  grid.replaceChildren(...photos.map(photo => {
   const card = el('figure', undefined, 'photo-card' + (photo.is_primary ? ' is-primary' : ''));
   const link = el('a'); link.href = photo.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
   const img = el('img'); img.loading = 'lazy'; img.alt = photo.original_name || 'Foto'; img.src = photo.url;
   // URL assinada vencida: pede a lista de novo, uma vez por exibição.
   img.onerror = () => { if (!retried) { retried = true; load(); } };
   link.append(img);
   const tools = el('figcaption');
   if (photo.is_primary) tools.append(el('span', 'Principal', 'photo-badge'));
   else {
    const main = el('button', 'Tornar principal', 'link-button'); main.type = 'button';
    main.onclick = () => act(() => fetch(`/api/media/${photo.id}/primary`, { method: 'POST' }));
    tools.append(main);
   }
   const remove = el('button', 'Remover', 'link-button'); remove.type = 'button';
   remove.onclick = () => { if (confirm('Remover esta foto?')) act(() => fetch(`/api/media/${photo.id}`, { method: 'DELETE' })); };
   tools.append(remove);
   card.append(link, tools);
   return card;
  }));
 }

 async function act(call) {
  say('');
  try {
   const response = await call();
   if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Não foi possível concluir.');
   retried = false; await load();
  } catch (error) { say(error.message, true); }
 }

 async function add(files) {
  const images = [...files].filter(file => file.type.startsWith('image/'));
  if (!images.length) { say('Nenhuma imagem encontrada no que foi colado ou solto.', true); return; }
  if (busy) return;
  busy = true; zone.classList.add('is-busy');
  const failures = [];
  for (const [index, file] of images.entries()) {
   say(`Enviando ${index + 1} de ${images.length}…`);
   try { await send(owner, file); } catch (error) { failures.push(error.message); }
  }
  busy = false; zone.classList.remove('is-busy');
  retried = false; await load();
  if (failures.length) say(failures[0] + (failures.length > 1 ? ` (+${failures.length - 1})` : ''), true);
  else say('');
 }

 zone.onclick = () => picker.click();
 zone.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); picker.click(); } };
 picker.onchange = () => { const files = picker.files; if (files?.length) add(files); picker.value = ''; };
 for (const name of ['dragenter', 'dragover']) root.addEventListener(name, event => { if (event.dataTransfer?.types?.includes('Files')) { event.preventDefault(); zone.classList.add('is-over'); } });
 root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget)) zone.classList.remove('is-over'); });
 root.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('is-over'); if (event.dataTransfer?.files?.length) add(event.dataTransfer.files); });

 // Colar vale para a tela inteira, mas só enquanto o painel está à vista e a pessoa
 // não está digitando em um campo (aí Ctrl+V é texto).
 const onPaste = event => {
  if (!root.isConnected) { document.removeEventListener('paste', onPaste); return; }
  if (root.offsetParent === null || typing(event.target)) return;
  const files = [...(event.clipboardData?.files || [])];
  if (files.length) { event.preventDefault(); add(files); }
 };
 document.addEventListener('paste', onPaste);

 load();
 return root;
}
