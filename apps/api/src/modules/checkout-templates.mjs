// Templates de checkout: aparência (marca) e modo de exibição por produto.
//
// Existe separado de billing_offers de propósito: a oferta é o que se cobra
// (preço, processador, modalidade); o template é como a página aparece
// (cor, logo, HOSTED/EMBEDDED/ELEMENTS). Vários produtos, várias marcas —
// "Skiller" e "TZOLKIN Barber" reutilizam a mesma oferta com templates
// diferentes, sem duplicar preço.
//
// Ver docs/BILLING.md e apps/api/src/modules/checkout-gateway.mjs, que lê
// este template para decidir como criar a sessão de pagamento.
import {input,text,isProductId,fail} from '../platform/http.mjs';
import {findProduct} from './catalog.mjs';

export const TEMPLATE_TYPES=['HOSTED','EMBEDDED','ELEMENTS'];

export function validateTemplate(body){
 input(body,['product_id','slug','name','type','branding','is_default','version']);
 if(!isProductId(body.product_id)||!isProductId(body.slug))throw fail(400,'Produto ou slug inválido.');
 if(!TEMPLATE_TYPES.includes(body.type))throw fail(400,'Tipo de checkout inválido.');
 if(!body.branding||typeof body.branding!=='object'||Array.isArray(body.branding))throw fail(400,'Marca inválida.');
 input(body.branding,['primary_color','logo_url','border_radius','font_family']);
 const {primary_color,logo_url,border_radius,font_family}=body.branding;
 if(!/^#[0-9a-f]{6}$/i.test(primary_color||''))throw fail(400,'Cor primária inválida. Use #rrggbb.');
 if(logo_url&&(typeof logo_url!=='string'||logo_url.length>500||!/^https:\/\//.test(logo_url)))throw fail(400,'URL do logo inválida. Use https.');
 if(!Number.isInteger(border_radius)||border_radius<0||border_radius>24)throw fail(400,'Arredondamento inválido.');
 if(typeof body.is_default!=='boolean')throw fail(400,'Padrão inválido.');
 if(!Number.isInteger(body.version)||body.version<0)throw fail(400,'Versão inválida.');
 return{
  product_id:body.product_id,slug:body.slug,name:text(body.name,2,100),type:body.type,is_default:body.is_default,
  branding:{primary_color:primary_color.toLowerCase(),logo_url:logo_url||'',border_radius,font_family:text(font_family,1,60)},
 };
}

export function checkoutTemplateRoutes(router){
 router.get('/api/checkout-templates',async({pool,url,reply})=>{
  const product=url.searchParams.get('product_id');
  if(!isProductId(product)||[...url.searchParams.keys()].some(k=>k!=='product_id')||url.searchParams.getAll('product_id').length!==1)throw fail(400,'Produto inválido.');
  if(!await findProduct(pool, product))throw fail(404,'Produto não encontrado.');
  const result=await pool.query('SELECT slug,payload,version,updated_at FROM checkout_templates WHERE product_id=$1 ORDER BY slug',[product]);
  return reply(200,{templates:result.rows,execution:'draft_only'});
 },{body:false});
 router.put('/api/checkout-templates',async({client,body})=>{
 const tpl=validateTemplate(body);
  if (!await findProduct(client, tpl.product_id)) throw fail(400, 'Produto não está disponível para checkout.');
  // Só um padrão por produto: desmarca os outros na mesma transação antes de gravar este.
  if(tpl.is_default)await client.query(`UPDATE checkout_templates SET payload=jsonb_set(payload,'{is_default}','false') WHERE product_id=$1 AND slug<>$2`,[tpl.product_id,tpl.slug]);
  const result=await client.query(`INSERT INTO checkout_templates(product_id,slug,payload)
   SELECT $1,$2,$3::jsonb WHERE $4=0
   ON CONFLICT(product_id,slug) DO NOTHING RETURNING version`,[tpl.product_id,tpl.slug,JSON.stringify(tpl),body.version]);
  if(!result.rows.length){
   if(body.version===0)throw fail(409,'Template já existe. Reabra antes de editar.');
   const updated=await client.query(`UPDATE checkout_templates SET payload=$3::jsonb,version=version+1,updated_at=now()
    WHERE product_id=$1 AND slug=$2 AND version=$4 RETURNING version`,[tpl.product_id,tpl.slug,JSON.stringify(tpl),body.version]);
   if(!updated.rows.length)throw fail(409,'Template alterado em outra sessão. Reabra antes de salvar.');
  }
  return {tenant:null,type:'checkout.template.saved'};
 },{transactional:true,audit:false});
}
