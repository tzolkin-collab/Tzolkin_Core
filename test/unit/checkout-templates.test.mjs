import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTemplate,checkoutTemplateRoutes} from '../../apps/api/src/modules/checkout-templates.mjs';

const template={product_id:'sites',slug:'padrao',name:'Padrão',type:'HOSTED',branding:{primary_color:'#111827',logo_url:'https://cdn.tzolkin.com/logo.png',border_radius:12,font_family:'system-ui'},is_default:true,version:0};

// Stub de client: responde por prefixo de SQL e registra a sequência, que é o
// que os testes de transação verificam.
const criarClient=({anterior=null}={})=>{
 const queries=[];
 return {queries,client:{query:async(sql,args)=>{
  queries.push([sql,args]);
  if(sql.startsWith('SELECT id,name FROM products'))return{rows:[{id:'sites',name:'Sites'}]};
  if(sql.startsWith('SELECT payload,version FROM checkout_templates'))return{rows:anterior?[anterior]:[]};
  if(sql.includes('RETURNING version'))return{rows:[{version:(anterior?.version??0)+1}]};
  return{rows:[]};
 }}};
};
const rotaPut=()=>{const rotas=new Map();checkoutTemplateRoutes({get(){},put:(p,f)=>rotas.set(p,f)});return rotas.get('/api/checkout-templates');};

test('validates type, cor, url do logo e arredondamento',()=>{
 assert.equal(validateTemplate(template).type,'HOSTED');
 for(const change of [
  {type:'CUSTOM'},
  {branding:{...template.branding,primary_color:'azul'}},
  {branding:{...template.branding,primary_color:'#fff'}},
  {branding:{...template.branding,logo_url:'http://inseguro.com/logo.png'}},
  {branding:{...template.branding,border_radius:1.5}},
  {branding:{...template.branding,border_radius:30}},
  {is_default:'sim'},
  {version:-1},
  {live:true},
 ])assert.throws(()=>validateTemplate({...template,...change}));
 assert.equal(validateTemplate({...template,branding:{...template.branding,logo_url:''}}).branding.logo_url,'');
});

test('corpo do editor antigo vira tema, com a fonte caindo para system',()=>{
 // 'system-ui' era texto livre e não corresponde a nenhuma fonte que sirvamos.
 const resultado=validateTemplate(template);
 assert.equal(resultado.theme.font_family,'system');
 assert.equal(resultado.theme.color,'#111827');
 assert.equal(resultado.theme.radius,12);
 // branding continua sendo escrito, derivado do tema: a 023 o preserva por uma
 // release para o dado não ficar órfão se este código for revertido.
 assert.deepEqual(resultado.branding,{primary_color:'#111827',logo_url:'https://cdn.tzolkin.com/logo.png',border_radius:12,font_family:'system'});
});

test('tema e copy novos convivem e guardam só o que foi escrito',()=>{
 const corpo={...template,branding:undefined,theme:{color:'#ff0000',density:'roomy'},copy:{headline:'Comece hoje',cancel_body:''}};
 delete corpo.branding;
 const resultado=validateTemplate(corpo);
 assert.deepEqual(resultado.theme,{color:'#ff0000',density:'roomy'},'guarda o delta, não o tema inteiro');
 assert.deepEqual(resultado.copy,{headline:'Comece hoje'},'texto vazio volta ao padrão em vez de gravar vazio');
 // Derivado do tema COMPLETO, senão branding sairia sem raio nem fonte.
 assert.equal(resultado.branding.border_radius,12);
 assert.throws(()=>validateTemplate({...corpo,theme:{color:'vermelho'}}),/Cor inválida/);
 assert.throws(()=>validateTemplate({...corpo,copy:{inexistente:'x'}}),/Campos inválidos/);
 assert.throws(()=>validateTemplate({...template,branding:undefined,theme:undefined}),/Envie o tema/);
});

test('criar grava o template e a revisão, na mesma transação',async()=>{
 const {queries,client}=criarClient();
 await rotaPut()({client,body:template,operator:{email:'gustavo@tzolkin.com'}});
 assert.match(queries[0][0],/SELECT id,name FROM products/);
 assert.match(queries[1][0],/SELECT payload,version FROM checkout_templates .* FOR UPDATE/);
 // Só um padrão por produto, desmarcado antes da gravação.
 assert.match(queries[2][0],/UPDATE checkout_templates SET payload=jsonb_set/);
 assert.deepEqual(queries[2][1],['sites','padrao']);
 assert.match(queries[3][0],/INSERT INTO checkout_templates/);
 const [sql,args]=queries[4];
 assert.match(sql,/INSERT INTO checkout_template_revisions/);
 assert.deepEqual(args.slice(0,5),['sites','padrao',1,'created','gustavo@tzolkin.com']);
 assert.equal(args[6],null,'criação não tem estado anterior');
});

test('editar registra a revisão com o estado que foi substituído',async()=>{
 const anterior={payload:{name:'Antigo',theme:{color:'#000000'}},version:3};
 const {queries,client}=criarClient({anterior});
 await rotaPut()({client,body:{...template,is_default:false,version:3},operator:{subject:'sub-123'}});
 const revisao=queries.find(([sql])=>sql.includes('checkout_template_revisions'));
 assert.deepEqual(revisao[1].slice(0,5),['sites','padrao',4,'updated','sub-123']);
 assert.deepEqual(JSON.parse(revisao[1][6]),anterior.payload,'before_value carrega o que foi substituído');
});

test('conflito de versão não sobrescreve',async()=>{
 const anterior={payload:{},version:9};
 const {client}=criarClient({anterior});
 // O UPDATE com WHERE version=$4 não casa, e o stub devolve [] para ele.
 const rota=rotaPut();
 await assert.rejects(rota({client:{query:async sql=>{
  if(sql.startsWith('SELECT id,name FROM products'))return{rows:[{id:'sites',name:'Sites'}]};
  if(sql.startsWith('SELECT payload,version'))return{rows:[anterior]};
  return{rows:[]};
 }},body:{...template,is_default:false,version:3}}),/outra sessão/);
});

test('editar um template que sumiu diz isso, em vez de culpar outra sessão',async()=>{
 // Antes as duas situações davam a mesma mensagem, porque o INSERT condicional
 // as confundia. Quem edita algo que foi apagado precisa saber que foi apagado.
 const {client}=criarClient();
 await assert.rejects(rotaPut()({client,body:{...template,version:3}}),/não encontrado/);
});
