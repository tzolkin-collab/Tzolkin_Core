// Templates de checkout: aparência e textos da página pública, por produto.
//
// Existe separado de billing_offers de propósito: a oferta é o que se cobra
// (preço, processador, modalidade); o template é como a página aparece e o que
// ela diz. Vários produtos, várias marcas — "Skiller" e "TZOLKIN Barber"
// reutilizam a mesma oferta com templates diferentes, sem duplicar preço.
//
// O schema do tema e da copy vive em platform/checkout-model.mjs, e é de lá que
// o editor do painel se desenha. Aqui só se valida, versiona e grava.
//
// `branding` continua sendo escrito, DERIVADO do tema. A migração 023 o preserva
// por uma release: se este código for revertido, a página antiga continua
// achando o que precisa. Derivar em vez de aceitar evita duas fontes de verdade.
//
// Ver docs/BILLING.md, docs/decisions/0006 e checkout-gateway.mjs, que lê este
// template para montar a página pública.
//
// REQUER a migração 023 (checkout_template_revisions).
import {input,text,isProductId,fail} from '../platform/http.mjs';
import {findEditableProduct} from './catalog.mjs';
import {validateTheme,validateCopy,mergeTheme,assertPayloadSize,editorSchema,isFont} from '../platform/checkout-model.mjs';

export const TEMPLATE_TYPES=['HOSTED','EMBEDDED','ELEMENTS'];

const actor=operator=>operator?.email||operator?.subject||'local-operator';

// Corpo do editor antigo: converte para tema. A fonte cai para 'system' porque
// o campo era texto livre e o navegador só renderiza o que existe — era
// exatamente por isso que ele nunca teve efeito.
function temaDoBranding(branding){
 if(!branding||typeof branding!=='object'||Array.isArray(branding))throw fail(400,'Marca inválida.');
 input(branding,['primary_color','logo_url','border_radius','font_family']);
 return validateTheme({
  color:branding.primary_color,
  logo_url:branding.logo_url||'',
  radius:branding.border_radius,
  font_family:isFont(branding.font_family)?branding.font_family:'system',
 });
}

const brandingDoTema=theme=>({primary_color:theme.color,logo_url:theme.logo_url,border_radius:theme.radius,font_family:theme.font_family});

export function validateTemplate(body){
 input(body,['product_id','slug','name','type','branding','theme','copy','is_default','version']);
 if(!isProductId(body.product_id)||!isProductId(body.slug))throw fail(400,'Produto ou slug inválido.');
 if(!TEMPLATE_TYPES.includes(body.type))throw fail(400,'Tipo de checkout inválido.');
 if(typeof body.is_default!=='boolean')throw fail(400,'Padrão inválido.');
 if(!Number.isInteger(body.version)||body.version<0)throw fail(400,'Versão inválida.');
 if(body.theme===undefined&&body.branding===undefined)throw fail(400,'Envie o tema do checkout.');
 // theme é o campo novo; branding só é lido quando ele não vem.
 const theme=body.theme===undefined?temaDoBranding(body.branding):validateTheme(body.theme);
 const template={
  product_id:body.product_id,slug:body.slug,name:text(body.name,2,100),type:body.type,is_default:body.is_default,
  // Guarda só o que o operador escreveu. O merge com os padrões acontece na
  // leitura, para que mudar um padrão alcance quem nunca editou aquele campo.
  theme,copy:body.copy===undefined?{}:validateCopy(body.copy),
  branding:brandingDoTema(mergeTheme(theme)),
 };
 assertPayloadSize(template);
 return template;
}

export function checkoutTemplateRoutes(router){
 router.get('/api/checkout-templates',async({pool,url,reply})=>{
  const product=url.searchParams.get('product_id');
  if(!isProductId(product)||[...url.searchParams.keys()].some(k=>k!=='product_id')||url.searchParams.getAll('product_id').length!==1)throw fail(400,'Produto inválido.');
  if(!await findEditableProduct(pool, product))throw fail(404,'Produto não encontrado.');
  const result=await pool.query('SELECT slug,payload,version,updated_at FROM checkout_templates WHERE product_id=$1 ORDER BY slug',[product]);
  // O descritor vai junto para o editor renderizar os campos a partir dele, em
  // vez de repetir a lista de tokens e textos no front — e as duas divergirem.
  return reply(200,{templates:result.rows,schema:editorSchema(),execution:'draft_only'});
 },{body:false});

 router.put('/api/checkout-templates',async({client,body,operator})=>{
  const tpl=validateTemplate(body);
  if(!await findEditableProduct(client,tpl.product_id))throw fail(400,'Produto não está disponível para checkout.');
  // Trava a linha antes de decidir: o before_value da revisão precisa do estado
  // exato que está sendo substituído, não de uma leitura anterior à transação.
  const anterior=(await client.query('SELECT payload,version FROM checkout_templates WHERE product_id=$1 AND slug=$2 FOR UPDATE',[tpl.product_id,tpl.slug])).rows[0]||null;
  // Só um padrão por produto: desmarca os outros na mesma transação.
  if(tpl.is_default)await client.query(`UPDATE checkout_templates SET payload=jsonb_set(payload,'{is_default}','false') WHERE product_id=$1 AND slug<>$2`,[tpl.product_id,tpl.slug]);

  let version;
  if(!anterior){
   if(body.version!==0)throw fail(409,'Template não encontrado. Reabra antes de editar.');
   version=(await client.query('INSERT INTO checkout_templates(product_id,slug,payload) VALUES($1,$2,$3::jsonb) RETURNING version',
    [tpl.product_id,tpl.slug,JSON.stringify(tpl)])).rows[0].version;
  }else{
   if(body.version===0)throw fail(409,'Template já existe. Reabra antes de editar.');
   const updated=await client.query(`UPDATE checkout_templates SET payload=$3::jsonb,version=version+1,updated_at=now()
    WHERE product_id=$1 AND slug=$2 AND version=$4 RETURNING version`,[tpl.product_id,tpl.slug,JSON.stringify(tpl),body.version]);
   if(!updated.rows.length)throw fail(409,'Template alterado em outra sessão. Reabra antes de salvar.');
   version=updated.rows[0].version;
  }
  // Trilha de domínio, no molde de product_resource_audit: audit_events exige
  // tenant_id NOT NULL e checkout não tem tenant, o que é a razão de audit:false.
  await client.query(`INSERT INTO checkout_template_revisions(product_id,template_slug,version,action,actor,payload,before_value)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
   [tpl.product_id,tpl.slug,version,anterior?'updated':'created',actor(operator),JSON.stringify(tpl),anterior?JSON.stringify(anterior.payload):null]);
  return {tenant:null,type:'checkout.template.saved'};
 },{transactional:true,audit:false});
}
