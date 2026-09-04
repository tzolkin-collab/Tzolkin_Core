// Catálogo do ecossistema: produtos e atalhos operacionais importados do Notion.
// Cadastro, não monitoramento: "status" aqui é o que foi registrado, não disponibilidade medida.

export const listProducts = client => client.query("SELECT id,name FROM products WHERE lifecycle_status='active' ORDER BY name");

export const findProduct = (client, productId) =>
 client.query("SELECT id,name FROM products WHERE id=$1 AND lifecycle_status='active'", [productId]).then(r => r.rows[0] || null);

// Drafts podem ser configurados no Core, mas não entram em contratação nem
// no contexto de acesso de um app. Cada rota de escrita comercial decide se
// usa esta consulta ou findProduct (ativo).
export const findEditableProduct = (client, productId) =>
 client.query("SELECT id,name FROM products WHERE id=$1 AND lifecycle_status IN ('active','draft')", [productId]).then(r => r.rows[0] || null);

export const findCatalogEntry = (client, productId) =>
 client.query("SELECT payload,imported_at FROM ecosystem_entries WHERE id=$1 AND kind='product'", [productId])
  .then(r => r.rows[0] || null);

export function catalogRoutes(router) {
 router.get('/api/ecosystem', async ({ pool, reply }) => {
  const result = await pool.query('SELECT kind,payload,imported_at FROM ecosystem_entries ORDER BY id');
  return reply(200, { entries: result.rows });
 });
}
