// Derivação de cadastro, não inferência de saúde ou publicação.
export function summarizeProject(project){
 const components=project.components||[],bindings=components.flatMap(c=>c.bindings||[]);
 return {services:components.length,targets:new Set(bindings.map(b=>[b.provider,b.target_id,b.environment].join(':'))).size,
  environments:[...new Set(bindings.map(b=>b.environment))],stacks:[...new Set(components.map(c=>c.stack).filter(s=>s&&s!=='custom'))],
  branches:[...new Set(bindings.map(b=>b.branch).filter(Boolean))],issues:(project.issues||[]).length};
}
