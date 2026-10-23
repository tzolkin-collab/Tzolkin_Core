// Validação e normalização de documentos brasileiros (CPF e CNPJ).
// O CNPJ passa a aceitar letras (12 primeiros caracteres alfanuméricos + 2 dígitos
// verificadores numéricos) para inscrições a partir de 2026.
import { digest } from './session.mjs';

export const stripDoc = raw => typeof raw === 'string' ? raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase() : '';

export function isValidCpf(raw) {
 if (typeof raw !== 'string') return false;
 const d = raw.replace(/\D/g, '');
 if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
 const digit = len => {
  let sum = 0;
  for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
 };
 return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

export function isValidCnpj(raw) {
 if (typeof raw !== 'string') return false;
 const c = stripDoc(raw);
 if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
 const value = ch => ch.charCodeAt(0) - 48;
 const digit = len => {
  const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + value(c[i]) * w, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
 };
 return digit(12) === Number(c[12]) && digit(13) === Number(c[13]);
}

export function formatCpf(raw) {
 if (typeof raw !== 'string') return '';
 const d = raw.replace(/\D/g, '').slice(0, 11);
 return d.replace(/^(\d{3})(\d{0,3})(\d{0,3})(\d{0,2}).*/, (_m, a, b, c, e) => [a, b && `.${b}`, c && `.${c}`, e && `-${e}`].filter(Boolean).join(''));
}

export function formatCnpj(raw) {
 if (typeof raw !== 'string') return '';
 const c = stripDoc(raw).slice(0, 14);
 return c.replace(/^(.{2})(.{0,3})(.{0,3})(.{0,4})(.{0,2}).*/, (_m, a, b, d, e, f) => [a, b && `.${b}`, d && `.${d}`, e && `/${e}`, f && `-${f}`].filter(Boolean).join(''));
}

export const maskCpf = raw => typeof raw === 'string' ? raw.replace(/\d(?=.*\d{2}$)/g, '•') : '';

export function cpfHash(raw) {
 if (!isValidCpf(raw)) return null;
 return digest(raw.replace(/\D/g, ''));
}
