// Server-only configuration. Prefer the explicit list over the legacy item.
export function pluggyItemIds(env = process.env) {
  const raw = env.PLUGGY_ITEM_IDS?.trim() || env.PLUGGY_ITEM_ID?.trim() || '';
  const ids = [...new Set(raw.split(',').map(value => value.trim()).filter(Boolean))];
  if (ids.some(id => !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) {
    throw new Error('PLUGGY_ITEM_IDS deve conter identificadores separados por vírgula.');
  }
  return ids;
}
