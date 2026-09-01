import { input, text, fail } from './http.mjs';

export const STACKS = [
 { id: 'nextjs', name: 'Next.js', runtime: 'node', manager: 'npm' },
 { id: 'vite', name: 'React / Vite', runtime: 'node', manager: 'npm' },
 { id: 'node', name: 'Node.js', runtime: 'node', manager: 'npm' },
 { id: 'python', name: 'Python', runtime: 'python', manager: 'uv' },
 { id: 'docker', name: 'Docker', runtime: 'container', manager: 'none' },
 { id: 'postgres', name: 'PostgreSQL', runtime: 'managed', manager: 'none' },
 { id: 'redis', name: 'Redis', runtime: 'managed', manager: 'none' },
 { id: 'custom', name: 'Outra stack', runtime: '', manager: 'none' },
];
export const KINDS = ['frontend', 'api', 'worker', 'library', 'database', 'cache'];
export const ENVIRONMENTS = ['development', 'staging', 'production'];
const choice = (value, values) => { if (!values.includes(value)) throw fail(400, 'Opção inválida.'); return value; };
const list = (value, max) => { if (!Array.isArray(value) || value.length > max) throw fail(400, 'Lista inválida ou acima do limite.'); return value; };
const slug = value => { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw fail(400, 'Identificador de componente inválido.'); return value; };
const optional = (value, max = 200) => value === '' || value == null ? '' : text(value, 1, max);
const path = value => {
 const result = text(value, 1, 180);
 if (result !== '.' && (!/^[\w.@-]+(?:\/[\w.@-]+)*$/.test(result) || result.split('/').some(s => s === '..' || s === '.')))
  throw fail(400, 'Use uma pasta relativa ao repositório, sem .. ou caminho absoluto.');
 return result;
};

export function validateProject(body) {
 input(body, ['name', 'owner', 'layout', 'repository_id', 'components', 'revision']);
 const components = list(body.components, 20).map(component => {
  input(component, ['id', 'name', 'kind', 'path', 'stack', 'runtime', 'manager', 'build', 'start', 'output', 'port', 'depends_on', 'bindings']);
  const kind = choice(component.kind, KINDS);
  const bindings = list(component.bindings, 3).map(binding => {
   input(binding, ['environment', 'provider', 'target_id', 'branch']);
   const branch = optional(binding.branch, 120);
   if (branch && (/\s|[~^:?*\[\\]|\.\.|@\{|\/\/|\.lock$|^\/|\/$|\.$/.test(branch))) throw fail(400, 'Branch inválida.');
   return { environment: choice(binding.environment, ENVIRONMENTS), provider: choice(binding.provider, ['vercel', 'easypanel']), target_id: text(binding.target_id, 1, 240), branch };
  });
  if (kind === 'library' && bindings.length) throw fail(400, 'Bibliotecas não possuem deploy próprio.');
  if (new Set(bindings.map(b => b.environment)).size !== bindings.length) throw fail(400, 'Ambiente repetido no componente.');
  const port = component.port === '' || component.port == null ? null : Number(component.port);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw fail(400, 'Porta inválida.');
  return { id: slug(component.id), name: text(component.name, 1, 100), kind,
   path: path(component.path), stack: choice(component.stack, STACKS.map(s => s.id)), runtime: optional(component.runtime, 60),
   manager: choice(component.manager, ['npm', 'pnpm', 'yarn', 'bun', 'uv', 'pip', 'none']),
   build: optional(component.build, 300), start: optional(component.start, 300), output: component.output ? path(component.output) : '', port,
   depends_on: list(component.depends_on, 20).map(slug), bindings };
 });
 const layout = choice(body.layout, ['single', 'monorepo']);
 if (layout === 'single' && components.filter(c => !['database', 'cache'].includes(c.kind)).length > 1) throw fail(400, 'Use monorepo para múltiplos componentes de código.');
 const ids = new Set(components.map(c => c.id));
 if (ids.size !== components.length) throw fail(400, 'Identificador de componente repetido.');
 const visiting = new Set(), visited = new Set();
 const visit = id => {
  if (!ids.has(id)) throw fail(400, 'Dependência não pertence a este projeto.');
  if (visiting.has(id)) throw fail(400, 'Dependências não podem formar um ciclo.');
  if (visited.has(id)) return;
  visiting.add(id); components.find(c => c.id === id).depends_on.forEach(visit); visiting.delete(id); visited.add(id);
 };
 ids.forEach(visit);
 const targets = components.flatMap(c => c.bindings.map(b => `${b.provider}:${b.target_id}:${b.environment}`));
 if (new Set(targets).size !== targets.length) throw fail(400, 'Destino já utilizado por outro componente neste ambiente.');
 return { name: text(body.name, 2, 120), owner: optional(body.owner, 120), layout,
  repository_id: body.repository_id ? text(body.repository_id, 1, 40) : null, components };
}

export function projectIssues(project) {
 const issues = [];
 if (!project.repository_id) issues.push('Repositório GitHub não vinculado.');
 if (!project.owner) issues.push('Responsável não informado.');
 if (!project.components.length) issues.push('Nenhum componente cadastrado.');
 for (const c of project.components) {
  if (!c.runtime) issues.push(`${c.name}: runtime não informado.`);
  if (c.kind !== 'library' && !c.bindings.length) issues.push(`${c.name}: nenhum destino vinculado.`);
  if (!['database', 'cache', 'library'].includes(c.kind) && c.bindings.some(b => !b.branch)) issues.push(`${c.name}: branch desejada não informada.`);
 }
 return issues;
}
