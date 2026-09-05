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
const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export function suggestProducts(products,labels){
 return products.flatMap(product=>{const aliases=[normalized(product.id),normalized(product.name).replace(/^tzolkin-/,'')].filter(a=>a.length>=3);
 const evidence=labels.filter(label=>aliases.some(alias=>normalized(label)===alias||('-'+normalized(label)+'-').includes('-'+alias+'-')));
 return evidence.length?[{product,evidence}]:[];});
}
