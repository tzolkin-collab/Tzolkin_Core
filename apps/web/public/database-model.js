export const tableKey=t=>JSON.stringify([t.schema||'public',t.name]);
export const resourceId=(database,schema,table)=>'postgresql/'+[database,schema,table].filter(v=>v!==undefined&&v!==null&&v!=='').map(encodeURIComponent).join('/');
export function targetTable(tables,source,relation){
 if(relation.schema&&relation.name)return tables.find(t=>t.schema===relation.schema&&t.name===relation.name);
 return tables.find(t=>`${t.schema}.${t.name}`===relation.table)||tables.find(t=>t.schema===source.schema&&t.name===relation.table);
}
export function tableEdges(tables){
 return tables.flatMap(source=>(source.relations||[]).map(relation=>({source,target:targetTable(tables,source,relation),...relation}))).filter(e=>e.target);
}
export function diagramLayout(tables,active){
 const edges=tableEdges(tables),key=tableKey(active);
 const incoming=tables.filter(t=>tableKey(t)!==key&&edges.some(e=>tableKey(e.source)===tableKey(t)&&tableKey(e.target)===key));
 const outgoing=tables.filter(t=>tableKey(t)!==key&&!incoming.includes(t)&&edges.some(e=>tableKey(e.source)===key&&tableKey(e.target)===tableKey(t)));
 const height=t=>54+t.columns.length*25;
 const stackHeight=list=>list.reduce((sum,t)=>sum+height(t)+40,0);
 const canvasHeight=Math.max(420,height(active)+80,stackHeight(incoming)+40,stackHeight(outgoing)+40);
 const nodes=[{table:active,x:390,y:Math.max(40,(canvasHeight-height(active))/2),height:height(active)}];
 for(const [list,x] of [[incoming,40],[outgoing,740]]){let y=40;for(const table of list){nodes.push({table,x,y,height:height(table)});y+=height(table)+40;}}
 const keys=new Set(nodes.map(n=>tableKey(n.table)));
 return {nodes,edges:edges.filter(e=>keys.has(tableKey(e.source))&&keys.has(tableKey(e.target))),width:1080,height:canvasHeight};
}
export function schemaDiagramLayout(tables, schema, { filter = '', onlyConnected = false } = {}) {
 const schemaTables = tables.filter(t => !schema || t.schema === schema);
 const allEdges = tableEdges(tables);
 const schemaEdges = allEdges.filter(e => e.source.schema === schema || e.target.schema === schema);

 let targetTables = schemaTables;
 if (onlyConnected) {
  const connectedKeys = new Set(schemaEdges.flatMap(e => [tableKey(e.source), tableKey(e.target)]));
  targetTables = targetTables.filter(t => connectedKeys.has(tableKey(t)));
 }
 if (filter) {
  const f = filter.toLowerCase().trim();
  targetTables = targetTables.filter(t => t.name.toLowerCase().includes(f));
 }

 const inDegree = new Map();
 const outDegree = new Map();
 for (const t of targetTables) {
  const k = tableKey(t);
  inDegree.set(k, schemaEdges.filter(e => tableKey(e.target) === k).length);
  outDegree.set(k, schemaEdges.filter(e => tableKey(e.source) === k).length);
 }

 const getRank = t => {
  const k = tableKey(t);
  const inD = inDegree.get(k) || 0;
  const outD = outDegree.get(k) || 0;
  if (t.name.endsWith('_audit') || t.name.endsWith('_history') || t.name.endsWith('_logs')) return 3;
  if (inD >= 4) return 0;
  if (inD >= 1 && outD >= 1) return 1;
  if (outD >= 1 && inD === 0) return 2;
  if (inD === 0 && outD === 0) return 3;
  return 1;
 };

 const columns = [[], [], [], []];
 for (const t of targetTables) {
  columns[getRank(t)].push(t);
 }

 for (const col of columns) {
  col.sort((a, b) => {
   const degA = (inDegree.get(tableKey(a)) || 0) + (outDegree.get(tableKey(a)) || 0);
   const degB = (inDegree.get(tableKey(b)) || 0) + (outDegree.get(tableKey(b)) || 0);
   return degB - degA || a.name.localeCompare(b.name);
  });
 }

 const CARD_WIDTH = 270;
 const CARD_GAP_X = 130;
 const CARD_GAP_Y = 24;
 const PADDING = 40;
 const height = t => Math.min(230, 52 + Math.min(t.columns.length, 6) * 23);

 const nodes = [];
 let maxCanvasHeight = 600;
 let currentX = PADDING;

 for (let colIdx = 0; colIdx < columns.length; colIdx++) {
  const col = columns[colIdx];
  if (!col.length) continue;
  let currentY = PADDING;
  for (const table of col) {
   const h = height(table);
   nodes.push({
    table,
    x: currentX,
    y: currentY,
    height: h,
    width: CARD_WIDTH,
    inCount: inDegree.get(tableKey(table)) || 0,
    outCount: outDegree.get(tableKey(table)) || 0,
   });
   currentY += h + CARD_GAP_Y;
  }
  if (currentY > maxCanvasHeight) maxCanvasHeight = currentY;
  currentX += CARD_WIDTH + CARD_GAP_X;
 }

 const nodeKeys = new Set(nodes.map(n => tableKey(n.table)));
 const edges = schemaEdges.filter(e => nodeKeys.has(tableKey(e.source)) && nodeKeys.has(tableKey(e.target)));

 return {
  nodes,
  edges,
  width: Math.max(1200, currentX),
  height: maxCanvasHeight + 60,
  totalTables: schemaTables.length,
  totalRelations: schemaEdges.length,
 };
}

const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export function suggestProducts(products,labels){
 return products.flatMap(product=>{const aliases=[normalized(product.id),normalized(product.name).replace(/^tzolkin-/,'')].filter(a=>a.length>=3);
 const evidence=labels.filter(label=>aliases.some(alias=>normalized(label)===alias||('-'+normalized(label)+'-').includes('-'+alias+'-')));
 return evidence.length?[{product,evidence}]:[];});
}
