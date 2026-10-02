import { fail, input, text } from './http.mjs';

// Campos próprios por espaço (fase 4). Regras puras de definição e de valor, sem banco, para o teste unitário
// cobrir todos os tipos. Tipos copiados da Kalidash (CustomFieldType). O que vai para o banco é `custom_data`,
// um objeto chave → valor; chave que o espaço não definiu (ou que está desativada) é recusada com 400, a mesma
// política do `input()` do intake.

export const ENTITIES = ['lead', 'opportunity', 'engagement'];
export const TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'BOOLEAN', 'LINK'];
export const MAX_FIELDS_PER_ENTITY = 40;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

/** Definição de campo vinda da API. Chave, tipo e entidade valem para sempre; o resto se edita em `updateInput`. */
export function definitionInput(body) {
 input(body, ['space_id', 'entity', 'key', 'label', 'type', 'options', 'required']);
 if (!ENTITIES.includes(body.entity)) throw fail(400, 'Entidade inválida.');
 if (typeof body.key !== 'string' || !KEY.test(body.key)) throw fail(400, 'Chave inválida (minúsculas, números e _, começando por letra).');
 if (!TYPES.includes(body.type)) throw fail(400, 'Tipo de campo inválido.');
 if (body.required != null && typeof body.required !== 'boolean') throw fail(400, 'Valor inválido.');
 return { entity: body.entity, key: body.key, label: text(body.label, 2, 80), type: body.type, options: optionsFor(body.type, body.options), required: body.required === true };
}

/** O que muda depois de criado: rótulo, opções, obrigatório, ativo, posição. */
export function updateInput(body, field) {
 input(body, ['version', 'label', 'options', 'required', 'is_active', 'position']);
 for (const k of ['required', 'is_active']) if (body[k] != null && typeof body[k] !== 'boolean') throw fail(400, 'Valor inválido.');
 if (body.position != null && (!Number.isInteger(body.position) || body.position < 0 || body.position > 1000)) throw fail(400, 'Posição inválida.');
 return {
  label: body.label == null ? field.label : text(body.label, 2, 80),
  options: Object.hasOwn(body, 'options') ? optionsFor(field.type, body.options) : field.options,
  required: body.required ?? field.required,
  is_active: body.is_active ?? field.is_active,
  position: body.position ?? field.position,
 };
}

function optionsFor(type, options) {
 const lista = type === 'SELECT' || type === 'MULTISELECT';
 if (!lista) { if (options != null) throw fail(400, 'Só campos de lista têm opções.'); return null; }
 if (!Array.isArray(options) || options.length < 1 || options.length > 50) throw fail(400, 'Informe de 1 a 50 opções.');
 const limpas = options.map(o => text(o, 1, 80));
 if (new Set(limpas.map(o => o.toLowerCase())).size !== limpas.length) throw fail(400, 'Opções repetidas.');
 return limpas;
}

/** Normaliza o valor de UM campo. `null`, `undefined` e texto vazio significam "sem valor" e devolvem `null`. */
export function normalizeValue(field, value) {
 if (value == null || value === '') return null;
 const erro = motivo => fail(400, `${field.label}: ${motivo}`);
 switch (field.type) {
  case 'TEXT':
   if (typeof value !== 'string' || value.length > 500 || CONTROL.test(value)) throw erro('texto inválido (até 500 caracteres).');
   return value.trim() || null;
  case 'NUMBER':
   if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw erro('número inválido.');
   return value;
  case 'DATE': {
   if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw erro('data inválida (AAAA-MM-DD).');
   return value;
  }
  case 'SELECT':
   if (typeof value !== 'string' || !field.options.includes(value)) throw erro('opção que não existe.');
   return value;
  case 'MULTISELECT':
   if (!Array.isArray(value) || value.length > field.options.length || new Set(value).size !== value.length || value.some(v => !field.options.includes(v))) throw erro('opções inválidas.');
   return value.length ? value : null;
  case 'BOOLEAN':
   if (typeof value !== 'boolean') throw erro('use verdadeiro ou falso.');
   return value;
  case 'LINK': {
   if (typeof value !== 'string' || value.length > 500 || CONTROL.test(value)) throw erro('endereço inválido.');
   let url; try { url = new URL(value.trim()); } catch { throw erro('endereço inválido.'); }
   if (!['http:', 'https:'].includes(url.protocol)) throw erro('só http ou https.');
   return value.trim();
  }
  default: throw fail(400, 'Tipo de campo inválido.');
 }
}

/**
 * Valida um objeto de valores contra os campos ATIVOS do espaço. Chave desconhecida (ou de campo desativado) → 400.
 * `enforceRequired` (cadastro novo) exige os obrigatórios; na edição só se recusa apagar um obrigatório.
 * Devolve só os pares com valor.
 */
export function validateSpaceData(fields, data, { enforceRequired = true } = {}) {
 if (data == null) data = {};
 if (typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'Dados do espaço inválidos.');
 const ativos = new Map(fields.filter(f => f.is_active).map(f => [f.key, f]));
 const resultado = {};
 for (const [key, value] of Object.entries(data)) {
  const field = ativos.get(key);
  if (!field) throw fail(400, `Campo desconhecido neste espaço: ${key.slice(0, 40)}.`);
  const v = normalizeValue(field, value);
  if (v !== null) resultado[key] = v;
  else if (!enforceRequired && field.required) throw fail(400, `${field.label} é obrigatório.`);
 }
 if (enforceRequired) for (const f of ativos.values()) if (f.required && !(f.key in resultado)) throw fail(400, `${f.label} é obrigatório.`);
 return resultado;
}

/** Valores que sobem de uma entidade para a próxima (lead → oportunidade → contratação): só chaves que o destino também define, com o mesmo tipo. */
export function carryOver(targetFields, data) {
 const resultado = {};
 for (const f of targetFields) if (f.is_active && data && Object.hasOwn(data, f.key) && data[f.key] != null) {
  try { const v = normalizeValue(f, data[f.key]); if (v !== null) resultado[f.key] = v; } catch { /* tipo ou opção diferente no destino: não leva */ }
 }
 return resultado;
}

/** Aplica uma edição: o que veio com valor entra, o que veio vazio apaga a chave, o que não veio (inclusive campo desativado) fica. */
export function applyChanges(existing, data, validated) {
 const resultado = { ...(existing || {}) };
 for (const key of Object.keys(data || {})) { if (key in validated) resultado[key] = validated[key]; else delete resultado[key]; }
 return resultado;
}

const COLUNAS = 'id,space_id,entity,key,label,type,options,required,is_active,position,version';
export const FIELD_COLUMNS = COLUNAS;
/** Campos de um espaço para uma entidade (ativos e desativados; quem valida escolhe). */
export async function fieldsOf(client, spaceId, entity) {
 return (await client.query(`SELECT ${COLUNAS} FROM space_fields WHERE space_id=$1 AND entity=$2 ORDER BY position,label`, [spaceId, entity])).rows;
}
