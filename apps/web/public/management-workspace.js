const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (className) node.className = className; return node; };

// Navegador estrutural: nenhum valor de produção chega ao browser. A inspiração
// é a separação de responsabilidades do DBeaver (navigator/editor/diagrama)
// com a seleção direta e busca rápida do Prisma Studio.
export function renderDatabaseWorkspace(root, tables) {
 const totalColumns = tables.reduce((sum, table) => sum + table.columns.length, 0);
 const totalRelations = tables.reduce((sum, table) => sum + (table.relations?.length || 0), 0);
 const workspace = el('section', undefined, 'dbw-workspace');
 const sidebar = el('aside', undefined, 'dbw-sidebar');
 const navigator = el('div', undefined, 'dbw-navigator');
 navigator.append(el('strong', 'TZOLKIN Core'), el('span', '▾ public', 'dbw-indent'), el('span', `▾ Tables · ${tables.length}`, 'dbw-indent dbw-tables-label'));
 const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Filtrar tabela'; search.setAttribute('aria-label', 'Filtrar tabela');
 const list = el('nav', undefined, 'dbw-table-list'); sidebar.append(navigator, search, list);
 const content = el('section', undefined, 'dbw-content'); workspace.append(sidebar, content);
 let selected = tables[0], view = 'schema';
 const select = table => { selected = table; view = 'table'; render(); };
 const renderList = () => { const query = search.value.trim().toLocaleLowerCase('pt-BR'); list.replaceChildren(...tables.filter(table => `${table.schema}.${table.name}`.toLocaleLowerCase('pt-BR').includes(query)).map(table => { const item = el('button', undefined, `dbw-table-item${table === selected ? ' active' : ''}`); item.type = 'button'; item.append(el('strong', table.name), el('span', `${table.columns.length} campos`, 'detail')); item.onclick = () => select(table); return item; })); };
 const tab = (key, label) => { const button = el('button', label, view === key ? 'active' : ''); button.type = 'button'; button.setAttribute('aria-pressed', String(view === key)); button.onclick = () => { view = key; render(); }; return button; };
 const renderSchema = () => {
  const map = el('div', undefined, 'dbw-diagram');
  for (const table of tables) { const entity = el('button', undefined, 'dbw-entity'); entity.type = 'button'; entity.append(el('strong', table.name), el('span', `${table.columns.length} campos`, 'detail')); const refs = table.relations || []; entity.append(el('span', refs.length ? `${refs.length} relações externas` : 'Sem relações externas', refs.length ? 'dbw-entity-relation' : 'detail')); entity.onclick = () => select(table); map.append(entity); }
  return map;
 };
 const renderTable = () => {
  const page = el('div', undefined, 'dbw-object-page');
  const breadcrumb = el('div', `TZOLKIN Core / ${selected.schema} / Tables`, 'dbw-breadcrumb');
  const headline = el('header', undefined, 'dbw-object-head'); headline.append(breadcrumb, el('h4', selected.name), el('p', `${selected.columns.length} campos · ${(selected.relations || []).length} relações`, 'detail'));
  const columns = el('table', undefined, 'dbw-columns'); const head = el('thead'); const headRow = el('tr'); ['Campo', 'Tipo', 'Aceita nulo'].forEach(label => headRow.append(el('th', label))); head.append(headRow); const body = el('tbody'); selected.columns.forEach(column => { const row = el('tr'); row.append(el('td', column.name), el('td', column.type), el('td', column.nullable ? 'Sim' : 'Não')); body.append(row); }); columns.append(head, body);
  const relations = el('aside', undefined, 'dbw-relations'); relations.append(el('h5', 'Relações')); if (!(selected.relations || []).length) relations.append(el('p', 'Esta tabela não possui chave estrangeira.', 'detail')); else selected.relations.forEach(relation => { const row = el('div', undefined, 'dbw-relation'); row.append(el('strong', relation.column), el('span', '→', 'dbw-arrow'), el('span', `${relation.table}.${relation.foreign_column}`, 'detail')); relations.append(row); });
  const split = el('div', undefined, 'dbw-table-split'); split.append(columns, relations); page.append(headline, split); return page;
 };
 const render = () => { renderList(); content.replaceChildren(); const toolbar = el('header', undefined, 'dbw-toolbar'); const tabs = el('nav', undefined, 'dbw-tabs'); tabs.append(tab('schema', 'Schema'), tab('table', 'Tabela')); toolbar.append(el('div', `${tables.length} tabelas · ${totalColumns} campos · ${totalRelations} relações`, 'dbw-summary'), tabs); content.append(toolbar, view === 'schema' ? renderSchema() : renderTable()); };
 search.oninput = renderList;
 render(); root.append(workspace);
}
