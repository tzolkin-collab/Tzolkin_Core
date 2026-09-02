import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTemplate,checkoutTemplateRoutes} from '../../apps/api/src/modules/checkout-templates.mjs';

const template={product_id:'sites',slug:'padrao',name:'Padrão',type:'HOSTED',branding:{primary_color:'#111827',logo_url:'https://cdn.tzolkin.com/logo.png',border_radius:12,font_family:'system-ui'},is_default:true,version:0};

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

test('só um template padrão por produto: desmarca os outros na mesma transação',async()=>{
 const routes=new Map();checkoutTemplateRoutes({get(){},put:(p,f)=>routes.set(p,f)});
 const queries=[];const client={query:async(sql,args)=>{queries.push([sql,args]);return{rows:sql.startsWith('SELECT id,name FROM products')?[{id:'sites',name:'Sites'}]:sql.includes('RETURNING version')?[{version:1}]:[]};}};
 await routes.get('/api/checkout-templates')({client,body:template});
 assert.match(queries[1][0],/UPDATE checkout_templates SET payload=jsonb_set/);
 assert.deepEqual(queries[1][1],['sites','padrao']);
});

test('conflito de versão não sobrescreve',async()=>{
 const routes=new Map();checkoutTemplateRoutes({get(){},put:(p,f)=>routes.set(p,f)});let calls=0;
 await assert.rejects(routes.get('/api/checkout-templates')({body:{...template,is_default:false,version:3},client:{query:async(sql)=>{calls++;if(sql.startsWith('SELECT id,name FROM products'))return{rows:[{id:'sites',name:'Sites'}]};return{rows:[]};}}}),/outra sessão/);
 assert.equal(calls,3);
});
