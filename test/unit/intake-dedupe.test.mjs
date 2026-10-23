import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  stripDoc,
  isValidCpf,
  isValidCnpj,
  formatCpf,
  formatCnpj,
  maskCpf,
  cpfHash,
} from '../../apps/api/src/platform/documents.mjs';
import {
  validateIntake,
  commercialIntakeRoutes,
  canonical,
} from '../../apps/api/src/modules/commercial-intake.mjs';
import { digest } from '../../apps/api/src/platform/session.mjs';

// CPF válido sintético para testes (passa no cálculo de dígitos verificadores)
const CPF_VALIDO_1 = '52998224725';
const CPF_VALIDO_MASCARADO = '529.982.247-25';
const CPF_VALIDO_2 = '11144477735'; // 111.444.777-35 passa nos dígitos verificadores

// CNPJ válido clássico e alfanumérico (padrão Receita Federal 2026+)
const CNPJ_NUMERICO_VALIDO = '11222333000181'; // 11.222.333/0001-81
const CNPJ_NUMERICO_MASCARADO = '11.222.333/0001-81';
const CNPJ_ALFANUMERICO_VALIDO = '12ABC34501DE35'; // 12.ABC.345/01DE-35

test('stripDoc limpa pontuação e converte para maiúsculo', () => {
 assert.equal(stripDoc('11.222.333/0001-81'), '11222333000181');
 assert.equal(stripDoc('12.abc.345/01de-35'), '12ABC34501DE35');
 assert.equal(stripDoc('529.982.247-25'), '52998224725');
 assert.equal(stripDoc(null), '');
 assert.equal(stripDoc(123), '');
});

test('isValidCpf valida dígitos verificadores e rejeita tamanhos errados e repetidos', () => {
 assert.equal(isValidCpf(CPF_VALIDO_1), true);
 assert.equal(isValidCpf(CPF_VALIDO_MASCARADO), true);
 assert.equal(isValidCpf(CPF_VALIDO_2), true);

 // dígitos repetidos
 assert.equal(isValidCpf('11111111111'), false);
 assert.equal(isValidCpf('00000000000'), false);
 // tamanho errado
 assert.equal(isValidCpf('123456789'), false);
 assert.equal(isValidCpf('123456789012'), false);
 // dígitos verificadores errados
 assert.equal(isValidCpf('52998224726'), false);
 assert.equal(isValidCpf('52998224735'), false);
 assert.equal(isValidCpf(''), false);
 assert.equal(isValidCpf(null), false);
});

test('isValidCnpj aceita numérico e alfanumérico (2026+) e valida dígitos verificadores', () => {
 assert.equal(isValidCnpj(CNPJ_NUMERICO_VALIDO), true);
 assert.equal(isValidCnpj(CNPJ_NUMERICO_MASCARADO), true);
 assert.equal(isValidCnpj(CNPJ_ALFANUMERICO_VALIDO), true);

 // dígitos verificadores errados
 assert.equal(isValidCnpj('11222333000182'), false);
 assert.equal(isValidCnpj('12ABC34501DE36'), false);
 // todos os caracteres iguais
 assert.equal(isValidCnpj('00000000000000'), false);
 assert.equal(isValidCnpj('AAAAAAAAAAAAAA'), false);
 // tamanho inválido
 assert.equal(isValidCnpj('1122233300018'), false);
 assert.equal(isValidCnpj('112223330001811'), false);
 assert.equal(isValidCnpj(''), false);
 assert.equal(isValidCnpj(null), false);
});

test('formatação e máscara de CPF e CNPJ', () => {
 assert.equal(formatCpf('52998224725'), '529.982.247-25');
 assert.equal(formatCnpj('11222333000181'), '11.222.333/0001-81');
 assert.equal(formatCnpj('12ABC34501DE35'), '12.ABC.345/01DE-35');
 assert.equal(maskCpf('52998224725'), '•••••••••25');
});

test('cpfHash calcula hash SHA-256 e nunca expõe o CPF', () => {
 const hash1 = cpfHash(CPF_VALIDO_1);
 const hash2 = cpfHash(CPF_VALIDO_MASCARADO);
 assert.equal(hash1.length, 64);
 assert.equal(hash1, hash2, 'mesmo CPF com e sem máscara gera o mesmo hash SHA-256');
 assert.equal(hash1, digest('52998224725'));
 assert.equal(cpfHash('11111111111'), null, 'CPF inválido retorna null');
});

// ---- Validação do Intake com Documentos ----

const payloadBase = () => ({
 lead: { name: 'João Santos', email: 'joao@empresa.com.br', whatsapp: '11988887777' },
 organization: { name: 'Empresa Santos Ltda', organization_type: 'company' },
 commercial: { product_id: 'sites', service_model: 'consulting' },
 privacy: {},
});

test('validateIntake aceita CPF no lead ou stakeholder e calcula cpf_hash', () => {
 const p = payloadBase();
 p.lead.cpf = CPF_VALIDO_MASCARADO;
 const v = validateIntake(p, 'sites');
 assert.equal(v.cpf_hash, digest('52998224725'));

 const p2 = payloadBase();
 p2.stakeholder = { role: 'decision_maker', document: CPF_VALIDO_1 };
 const v2 = validateIntake(p2, 'sites');
 assert.equal(v2.cpf_hash, digest('52998224725'));
});

test('validateIntake rejeita CPF inválido com status 400', () => {
 const p = payloadBase();
 p.lead.cpf = '123.456.789-00';
 assert.throws(() => validateIntake(p, 'sites'), { status: 400, message: /CPF inválido/ });
});

test('validateIntake aceita CNPJ (numérico ou alfanumérico) na organization e normaliza tax_id', () => {
 const p = payloadBase();
 p.organization.cnpj = CNPJ_NUMERICO_MASCARADO;
 const v = validateIntake(p, 'sites');
 assert.equal(v.tax_id, '11222333000181');

 const p2 = payloadBase();
 p2.organization.tax_id = '12.abc.345/01de-35';
 const v2 = validateIntake(p2, 'sites');
 assert.equal(v2.tax_id, '12ABC34501DE35');
});

test('validateIntake rejeita CNPJ inválido com status 400', () => {
 const p = payloadBase();
 p.organization.cnpj = '11.222.333/0001-00';
 assert.throws(() => validateIntake(p, 'sites'), { status: 400, message: /CNPJ inválido/ });
});

test('hash de idempotência inclui cpf_hash e tax_id quando presentes e preserva antigos sem documento', () => {
 const baseSemDoc = validateIntake(payloadBase(), 'sites');
 const baseComCpf = validateIntake({ ...payloadBase(), lead: { ...payloadBase().lead, cpf: CPF_VALIDO_1 } }, 'sites');
 const baseComCnpj = validateIntake({ ...payloadBase(), organization: { ...payloadBase().organization, cnpj: CNPJ_NUMERICO_VALIDO } }, 'sites');

 assert.notEqual(digest(canonical(baseSemDoc)), digest(canonical(baseComCpf)));
 assert.notEqual(digest(canonical(baseSemDoc)), digest(canonical(baseComCnpj)));
 assert.notEqual(digest(canonical(baseComCpf)), digest(canonical(baseComCnpj)));
});

// ---- Teste de Deduplicação ponta a ponta no Intake ----

function criarRoteadorMock() {
 const rotas = {};
 return {
  rotas,
  post: (path, fn) => { rotas[`POST ${path}`] = fn; },
 };
}

test('resolveParties deduplica pessoa por hash de CPF mesmo com e-mails diferentes', async () => {
 const r = criarRoteadorMock();
 commercialIntakeRoutes(r, { avisarLeadNovo: async () => {} });

 const stakeholderExistenteId = randomUUID();
 const tenantExistenteId = randomUUID();
 const queries = [];

 const fakeClient = {
  query: async (sql, args = []) => {
   queries.push([sql, args]);
   if (sql.includes('count(*) FROM commercial_leads')) return { rows: [{ count: '0' }] };
   if (sql.includes('FROM commercial_intake_requests') || sql.includes('FROM commercial_leads WHERE product_id')) return { rows: [] };
   // Busca de stakeholder por document_hash
   if (sql.includes('FROM stakeholders WHERE document_hash=$1')) {
    if (args[0] === digest('52998224725')) {
     return { rows: [{ id: stakeholderExistenteId }] };
    }
   }
   if (sql.includes('FROM organization_stakeholders os JOIN tenants t')) {
    return { rows: [{ id: tenantExistenteId, name: 'Empresa Santos Ltda', relationship_kind: 'prospect', lifecycle_status: 'lead' }] };
   }
   if (sql.includes('INSERT INTO commercial_leads')) return { rows: [{ id: randomUUID() }] };
   return { rows: [], rowCount: 1 };
  },
 };

 const p = payloadBase();
 p.lead.email = 'novo-email@empresa.com.br';
 p.lead.cpf = CPF_VALIDO_1;

 const res = await r.rotas['POST /v1/commercial/intake']({
  client: fakeClient,
  pool: {},
  body: p,
  productId: 'sites',
  req: { headers: { 'idempotency-key': randomUUID() } },
 });

 assert.equal(res.body.stakeholder_id, stakeholderExistenteId, 'reaproveitou o stakeholder pelo hash do CPF');
 assert.equal(res.body.tenant_id, tenantExistenteId, 'reaproveitou a empresa vinculada');
 // Verifica que os locks foram solicitados nas chaves certas
 assert.ok(queries.some(q => q[0].includes('pg_advisory_xact_lock') && q[1][0] === 'novo-email@empresa.com.br'));
 assert.ok(queries.some(q => q[0].includes('pg_advisory_xact_lock') && q[1][0] === digest('52998224725')));
});

test('resolveParties deduplica organização por CNPJ mesmo para contatos novos', async () => {
 const r = criarRoteadorMock();
 commercialIntakeRoutes(r, { avisarLeadNovo: async () => {} });

 const novoStakeholderId = randomUUID();
 const tenantPorCnpjId = randomUUID();
 const queries = [];

 const fakeClient = {
  query: async (sql, args = []) => {
   queries.push([sql, args]);
   if (sql.includes('count(*) FROM commercial_leads')) return { rows: [{ count: '0' }] };
   if (sql.includes('FROM commercial_intake_requests') || sql.includes('FROM commercial_leads WHERE product_id')) return { rows: [] };
   // Nenhuma pessoa encontrada
   if (sql.includes('FROM stakeholders WHERE lower(email)')) return { rows: [] };
   // Tenant encontrado por tax_id (CNPJ)
   if (sql.includes('FROM tenants WHERE tax_id=$1')) {
    if (args[0] === '11222333000181') {
     return { rows: [{ id: tenantPorCnpjId, name: 'Empresa Santos Existente', relationship_kind: 'customer', lifecycle_status: 'active' }] };
    }
   }
   if (sql.includes('INSERT INTO stakeholders')) return { rows: [{ id: novoStakeholderId }] };
   if (sql.includes('INSERT INTO commercial_leads')) return { rows: [{ id: randomUUID() }] };
   return { rows: [], rowCount: 1 };
  },
 };

 const p = payloadBase();
 p.organization.cnpj = CNPJ_NUMERICO_MASCARADO;

 const res = await r.rotas['POST /v1/commercial/intake']({
  client: fakeClient,
  pool: {},
  body: p,
  productId: 'sites',
  req: { headers: { 'idempotency-key': randomUUID() } },
 });

 assert.equal(res.body.stakeholder_id, novoStakeholderId, 'criou novo stakeholder');
 assert.equal(res.body.tenant_id, tenantPorCnpjId, 'reaproveitou o tenant existente pelo CNPJ');
 assert.equal(res.body.returning_client, true, 'marcou returning_client pois a empresa encontrada por CNPJ é customer ativo');
 assert.ok(queries.some(q => q[0].includes('pg_advisory_xact_lock') && q[1][0] === '11222333000181'));
});

test('migração 068 é segura, idempotente e não usa comandos destrutivos nem transação manual', () => {
 const sql = readFileSync(new URL('../../db/migrations/068_stakeholders_tenants_documents.sql', import.meta.url), 'utf8');
 const limpo = sql.replace(/--.*$/gm, '');
 assert.ok(!/\b(DROP TABLE|DROP COLUMN|DELETE|TRUNCATE|ALTER COLUMN|RENAME)\b/i.test(limpo));
 assert.ok(!/^\s*(BEGIN|COMMIT|ROLLBACK)\b/im.test(limpo), 'o migrate.mjs é o único dono da transação (G2)');
 assert.match(sql, /ALTER TABLE stakeholders ADD COLUMN IF NOT EXISTS document_hash text/);
 assert.match(sql, /ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_id text/);
 assert.match(sql, /stakeholders_document_hash_idx/);
 assert.match(sql, /tenants_tax_id_idx/);
});
