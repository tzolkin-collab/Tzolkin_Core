export const $ = id => document.getElementById(id);

export function node(tag, text, className) {
 const el = document.createElement(tag);
 if (text !== undefined) el.textContent = text;
 if (className) el.className = className;
 return el;
}

export function option(value, label) {
 const el = node('option', label);
 el.value = value;
 return el;
}

/**
 * Escapa caracteres especiais de HTML para prevenir injeção em contextos de texto/markup.
 */
export function escapeHtml(str) {
 if (str === null || str === undefined) return '';
 return String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
}

/**
 * Micro-helper ergonômico para construção segura de elementos DOM (Anti-XSS).
 * Não utiliza innerHTML; valores textuais são sempre adicionados como TextNode.
 */
export function el(tag, props = {}, ...children) {
 const element = document.createElement(tag);
 for (const [key, val] of Object.entries(props || {})) {
  if (val === undefined || val === null) continue;
  if (key === 'className') element.className = val;
  else if (key === 'dataset' && typeof val === 'object') Object.assign(element.dataset, val);
  else if (key.startsWith('on') && typeof val === 'function') element[key] = val;
  else if (typeof val === 'boolean') { if (val) element.setAttribute(key, ''); }
  else element.setAttribute(key, String(val));
 }
 for (const child of children.flat()) {
  if (child === null || child === undefined || child === false) continue;
  if (child instanceof Node) element.append(child);
  else element.append(document.createTextNode(String(child)));
 }
 return element;
}

