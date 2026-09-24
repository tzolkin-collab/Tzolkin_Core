// Conferência SOMENTE LEITURA do modelo de dono único das conexões (migração 034).
//
// Existe porque a pergunta "sobrou alguma conexão sem dono, com dois donos, ou só na
// tabela antiga?" não tem tela: até o deploy da fase seguinte, a única forma de
// responder é consultando o banco. Roda dentro de uma transação READ ONLY para que
// nem um engano de digitação consiga escrever.
//
// Nada sensível sai daqui: sem e-mail, sem telefone, sem URL, sem valor, sem nome de
// organização ou de contratação — nem o id da contratação, só a contagem delas. Saem
// contagem, provedor, tipo, nome de projeto de deploy, id do item do portfólio e o
// motivo do desligamento, que a 034 grava genérico justamente para poder ser lido.
//
// Uso: node --env-file=.env scripts/check-conexoes.mjs
// Saída: 0 tudo coerente · 2 há o que decidir · 3 a 034 ainda não foi aplicada · 1 falhou.
import { openDatabase } from '../apps/api/src/platform/database.mjs';

const conferir = async client => {
 await client.query('BEGIN TRANSACTION READ ONLY');

 // Antes da 034 as colunas de dono e de estado não existem, e o erro do banco sairia
 // como um código cru. Dizer isso em português é mais útil do que "42703".
 const migrada = (await client.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_name='product_resource_bindings' AND column_name='engagement_id') AS ok`)).rows[0].ok;
 if (!migrada) return { saida: 3, relatorio: { check: 'pendente', motivo: 'a migração 034 ainda não foi aplicada neste banco' } };

 const resumo = (await client.query(`SELECT
   count(*)::int AS total,
   count(*) FILTER (WHERE active)::int AS ativas,
   count(*) FILTER (WHERE active AND product_id IS NOT NULL)::int AS de_item,
   count(*) FILTER (WHERE active AND engagement_id IS NOT NULL)::int AS de_contratacao,
   count(*) FILTER (WHERE NOT active)::int AS desligadas,
   count(*) FILTER (WHERE external_id_kind = 'name')::int AS com_id_nominal
   FROM product_resource_bindings`)).rows[0];

 const porTipo = (await client.query(`SELECT resource_type, provider, count(*)::int AS total
   FROM product_resource_bindings WHERE active GROUP BY 1,2 ORDER BY 1,2`)).rows;

 // Conexão ativa sem dono ou com dois não deveria existir: o CHECK da 034 impede.
 // Se aparecer aqui, alguém desligou a restrição.
 const semDono = (await client.query(`SELECT count(*)::int AS total FROM product_resource_bindings
   WHERE active AND num_nonnulls(product_id, engagement_id) <> 1`)).rows[0].total;

 const repetidas = (await client.query(`SELECT provider, external_id, count(*)::int AS total
   FROM product_resource_bindings WHERE active AND resource_type NOT IN ('checkout','email')
   GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 1,2`)).rows;

 // O que ainda só existe nas tabelas antigas: é o saldo que falta copiar.
 const soNaAntiga = (await client.query(`
   SELECT 'product_deploy_bindings' AS tabela, d.provider, d.external_project_name AS projeto
     FROM product_deploy_bindings d WHERE NOT EXISTS
      (SELECT 1 FROM product_resource_bindings r WHERE r.provider=d.provider AND r.external_id=d.external_project_id)
   UNION ALL
   SELECT 'service_deploy_bindings', s.provider, s.external_project_name
     FROM service_deploy_bindings s WHERE NOT EXISTS
      (SELECT 1 FROM product_resource_bindings r WHERE r.provider=s.provider AND r.external_id=s.external_project_id)
   ORDER BY 1,2,3`)).rows;

 // Dono divergente entre a tabela nova e a antiga: é o que a 034 se recusa a adivinhar.
 const divergentes = (await client.query(`
   SELECT d.provider, d.external_project_name AS projeto
     FROM product_deploy_bindings d
     JOIN product_resource_bindings r ON r.provider=d.provider AND r.external_id=d.external_project_id
    WHERE r.active AND r.product_id IS DISTINCT FROM d.product_id
   UNION ALL
   SELECT s.provider, s.external_project_name
     FROM service_deploy_bindings s
     JOIN product_resource_bindings r ON r.provider=s.provider AND r.external_id=s.external_project_id
    WHERE r.active AND r.engagement_id IS DISTINCT FROM s.engagement_id
   ORDER BY 1,2`)).rows;

 // A conexão desligada é o registro que mais precisa aparecer: é a única que a 034
 // deixa de propósito sem dono, e ela cai fora de todas as listas acima (que olham
 // só o que está ativo). Sem esta, a conferência responderia "1 desligada" e não
 // diria qual nem por quê — justamente a pergunta que não tem tela para responder.
 const desligadas = (await client.query(`SELECT provider, resource_type, external_id_kind,
   display_name AS projeto, unbind_reason AS motivo, product_id AS item, deactivated_at
   FROM product_resource_bindings WHERE NOT active ORDER BY provider, display_name`)).rows;

 const trilha = (await client.query(`SELECT action, count(*)::int AS total
   FROM product_resource_audit GROUP BY 1 ORDER BY 1`)).rows;

 return {
  // Sai diferente de zero quando há algo para um humano decidir.
  saida: semDono || repetidas.length || divergentes.length ? 2 : 0,
  relatorio: {
   resumo, por_tipo: porTipo, trilha,
   // Sai com saída 0: não é pendência, é registro.
   desligadas,
   ativas_sem_um_dono: semDono,
   recursos_com_dois_vinculos_ativos: repetidas,
   so_na_tabela_antiga: soNaAntiga,
   dono_divergente: divergentes,
  },
 };
};

let pool;
try {
 ({ pool } = await openDatabase({ connectionString: process.env.DATABASE_URL, mode: 'require', max: 1 }));
 const client = await pool.connect();
 let resultado;
 try { resultado = await conferir(client); } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
 console.log(JSON.stringify(resultado.relatorio, null, 1));
 process.exitCode = resultado.saida;
} catch (error) {
 // A mensagem do banco pode trazer host e usuário: só o código do erro sai.
 console.log(JSON.stringify({ check: 'failed', error: error.code || 'unavailable' }));
 process.exitCode = 1;
} finally { await pool?.end(); }
