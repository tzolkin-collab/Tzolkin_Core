// Seeds realistic mock financial entries (bank transactions, gateway sales, and balances)
// for testing filters by year, day, month and custom ranges.
// All mock items have IDs starting with 'mock-' and is_mock: true for easy removal.

import {openDatabase} from '../apps/api/src/platform/database.mjs';

// --- TRANSAÇÕES NUBANK SETEMBRO 2026 ---
const mockTransactionsNubankSep = [
 {id:'mock-tx-nu-sep-01',date:'2026-09-01T10:15:00Z',description:'Pix recebido · Soluções Digitais Ltda (Contrato Mensal)',amount:8500.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-sep-02',date:'2026-09-01T14:30:00Z',description:'Pix recebido · Lucas Carvalho (Mentoria Executiva)',amount:3200.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-sep-03',date:'2026-09-02T09:20:00Z',description:'Pix recebido · Alpha Marketing (Desenvolvimento Web)',amount:12000.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-sep-04',date:'2026-09-02T16:45:00Z',description:'Pix recebido · Horizon Consultoria (Parcela 2/4)',amount:6800.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-sep-05',date:'2026-09-03T08:10:00Z',description:'Pix recebido · Marina Silva (Assinatura Consultoria)',amount:1950.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-sep-06',date:'2026-09-03T11:00:00Z',description:'Pix recebido · EducarTech (Treinamento In-Company)',amount:9400.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-sep-out-01',date:'2026-09-02T13:00:00Z',description:'Pix enviado · Infraestrutura Cloud e Servidores',amount:-1450.00,currency:'BRL',type:'DEBIT',status:'POSTED',is_mock:true},
];

// --- TRANSAÇÕES NUBANK AGOSTO 2026 ---
const mockTransactionsNubankAug = [
 {id:'mock-tx-nu-aug-01',date:'2026-08-05T10:00:00Z',description:'Pix recebido · Prime Consultoria (Entrada Projeto)',amount:14500.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-aug-02',date:'2026-08-10T11:20:00Z',description:'Pix recebido · Nexus Tech (Implantação de Software)',amount:15000.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-aug-03',date:'2026-08-14T15:45:00Z',description:'Pix recebido · Rodrigo Medeiros (Mentoria Avançada)',amount:4500.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-aug-04',date:'2026-08-20T15:30:00Z',description:'Pix recebido · Grupo Vanguarda (Consultoria Estratégica)',amount:11500.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-aug-05',date:'2026-08-25T14:10:00Z',description:'Pix recebido · Beatriz Santos (Mentoria Individual)',amount:3200.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-aug-06',date:'2026-08-28T09:30:00Z',description:'Pix recebido · Inovare Labs (Desenvolvimento MVP)',amount:8900.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-aug-out-01',date:'2026-08-15T10:00:00Z',description:'Pix enviado · Ferramentas SaaS e Licenças',amount:-890.00,currency:'BRL',type:'DEBIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-nu-aug-out-02',date:'2026-08-22T16:00:00Z',description:'Pix enviado · Serviços de Design e Ilustração',amount:-2100.00,currency:'BRL',type:'DEBIT',status:'POSTED',is_mock:true},
];

// --- TRANSAÇÕES BANCO INTER SETEMBRO 2026 ---
const mockTransactionsInterSep = [
 {id:'mock-tx-inter-sep-01',date:'2026-09-01T11:45:00Z',description:'TED recebida · Repasse Vendas Gateways',amount:14850.20,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-inter-sep-02',date:'2026-09-02T17:10:00Z',description:'Recebimento Boleto Cobrança #2094 · Alpha Soluções',amount:5400.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-inter-sep-03',date:'2026-09-03T10:30:00Z',description:'Pix recebido · Contrato Anual Tecnologia',amount:18000.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
];

// --- TRANSAÇÕES BANCO INTER AGOSTO 2026 ---
const mockTransactionsInterAug = [
 {id:'mock-tx-inter-aug-01',date:'2026-08-08T14:15:00Z',description:'TED recebida · Repasse Stripe Mensal',amount:16200.50,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-inter-aug-02',date:'2026-08-18T16:00:00Z',description:'TED recebida · Faturamento Corporativo Contrato Anual',amount:22000.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
 {id:'mock-tx-inter-aug-03',date:'2026-08-27T11:20:00Z',description:'Recebimento Boleto Cobrança #1980 · Beta Sistemas',amount:7800.00,currency:'BRL',type:'CREDIT',status:'POSTED',is_mock:true},
];

// --- STRIPE VENDAS SETEMBRO 2026 ---
const mockStripeSalesSep = [
 {id:'mock-sale-str-sep-01',provider:'stripe',date:'2026-09-01T09:12:00Z',description:'Assinatura Tzolkin Core - Plano Pro',amount:490.00,currency:'BRL',gross:490.00,fee:21.56,net:468.44,status:'received',is_mock:true},
 {id:'mock-sale-str-sep-02',provider:'stripe',date:'2026-09-01T14:25:00Z',description:'Assinatura Tzolkin Core - Anual Enterprise',amount:4800.00,currency:'BRL',gross:4800.00,fee:196.80,net:4603.20,status:'received',is_mock:true},
 {id:'mock-sale-str-sep-03',provider:'stripe',date:'2026-09-02T10:05:00Z',description:'Mentoria de Arquitetura de Software',amount:2500.00,currency:'BRL',gross:2500.00,fee:102.50,net:2397.50,status:'received',is_mock:true},
 {id:'mock-sale-str-sep-04',provider:'stripe',date:'2026-09-02T15:40:00Z',description:'Assinatura Tzolkin Core - Starter',amount:197.00,currency:'BRL',gross:197.00,fee:8.87,net:188.13,status:'received',is_mock:true},
 {id:'mock-sale-str-sep-05',provider:'stripe',date:'2026-09-03T11:15:00Z',description:'Serviço Adicional Cloud Deploy',amount:1200.00,currency:'BRL',gross:1200.00,fee:49.20,net:1150.80,status:'received',is_mock:true},
];

// --- STRIPE VENDAS AGOSTO 2026 ---
const mockStripeSalesAug = [
 {id:'mock-sale-str-aug-01',provider:'stripe',date:'2026-08-04T10:20:00Z',description:'Assinatura Tzolkin Core - Anual Enterprise',amount:4800.00,currency:'BRL',gross:4800.00,fee:196.80,net:4603.20,status:'received',is_mock:true},
 {id:'mock-sale-str-aug-02',provider:'stripe',date:'2026-08-11T16:30:00Z',description:'Mentoria Executiva em Grupo - Turma 04',amount:3600.00,currency:'BRL',gross:3600.00,fee:147.60,net:3452.40,status:'received',is_mock:true},
 {id:'mock-sale-str-aug-03',provider:'stripe',date:'2026-08-19T14:10:00Z',description:'Assinatura Tzolkin Core - Plano Pro',amount:490.00,currency:'BRL',gross:490.00,fee:21.56,net:468.44,status:'received',is_mock:true},
 {id:'mock-sale-str-aug-04',provider:'stripe',date:'2026-08-26T09:45:00Z',description:'Consultoria Técnica Sob Demanda',amount:2100.00,currency:'BRL',gross:2100.00,fee:86.10,net:2013.90,status:'received',is_mock:true},
];

// --- ASAAS VENDAS SETEMBRO 2026 ---
const mockAsaasSalesSep = [
 {id:'mock-sale-asaas-sep-01',provider:'asaas',date:'2026-09-01T11:30:00Z',description:'Cobrança Pix - Fatura #3081 · Consultoria Tech',amount:3500.00,currency:'BRL',gross:3500.00,fee:1.99,net:3498.01,status:'received',is_mock:true},
 {id:'mock-sale-asaas-sep-02',provider:'asaas',date:'2026-09-02T13:45:00Z',description:'Boleto liquidado - Mensalidade Contrato #104',amount:7200.00,currency:'BRL',gross:7200.00,fee:3.49,net:7196.51,status:'received',is_mock:true},
 {id:'mock-sale-asaas-sep-03',provider:'asaas',date:'2026-09-03T09:50:00Z',description:'Cobrança Recorrente - Manutenção e Suporte Cloud',amount:2800.00,currency:'BRL',gross:2800.00,fee:1.99,net:2798.01,status:'received',is_mock:true},
];

// --- ASAAS VENDAS AGOSTO 2026 ---
const mockAsaasSalesAug = [
 {id:'mock-sale-asaas-aug-01',provider:'asaas',date:'2026-08-06T11:00:00Z',description:'Boleto liquidado - Implantação Sistema Contrato #98',amount:8500.00,currency:'BRL',gross:8500.00,fee:3.49,net:8496.51,status:'received',is_mock:true},
 {id:'mock-sale-asaas-aug-02',provider:'asaas',date:'2026-08-16T15:20:00Z',description:'Cobrança Pix - Consultoria Estratégica Quinzena',amount:4200.00,currency:'BRL',gross:4200.00,fee:1.99,net:4198.01,status:'received',is_mock:true},
 {id:'mock-sale-asaas-aug-03',provider:'asaas',date:'2026-08-24T10:10:00Z',description:'Boleto liquidado - Parcela 1/3 Licenciamento',amount:6000.00,currency:'BRL',gross:6000.00,fee:3.49,net:5996.51,status:'received',is_mock:true},
];

async function seed(){
 let pool;
 try{
  ({pool}=await openDatabase({connectionString:process.env.DATABASE_URL,mode:'require',max:1}));
  console.log('Conectado ao banco para inserção de dados sintéticos de teste...');

  // 1. Identificar contas bancárias e fazer backup dos saldos originais
  const items=(await pool.query("SELECT key, payload FROM finance_snapshots WHERE key LIKE 'item:%'")).rows;

  // Backup dos saldos originais se ainda não existir
  const backupRow=(await pool.query("SELECT payload FROM finance_snapshots WHERE key='meta:mock_balances_backup'")).rows[0];
  if(!backupRow){
   const balanceBackup={};
   for(const it of items){
    balanceBackup[it.key]=(it.payload?.accounts||[]).map(a=>({id:a.id,balance:a.balance}));
   }
   await pool.query("INSERT INTO finance_snapshots(key,payload,updated_at) VALUES('meta:mock_balances_backup',$1,now()) ON CONFLICT(key) DO NOTHING",[JSON.stringify(balanceBackup)]);
   console.log('✓ Backup dos saldos originais salvo com sucesso em meta:mock_balances_backup');
  }

  // 2. Atualizar saldos das contas para valores realistas
  for(const it of items){
   let changed=false;
   const accounts=(it.payload?.accounts||[]).map(acc=>{
    if(acc.bank==='Nubank'||acc.name?.toLowerCase().includes('nu pagamentos')){
     changed=true;
     return {...acc,balance:17500.00};
    }
    if(acc.bank==='Banco Inter'||acc.name?.toLowerCase().includes('inter')){
     changed=true;
     return {...acc,balance:10500.00};
    }
    if(acc.type==='CREDIT'&&acc.balance===0){
     changed=true;
     return {...acc,balance:850.40};
    }
    return acc;
   });
   if(changed){
    const updatedPayload={...it.payload,accounts};
    await pool.query("UPDATE finance_snapshots SET payload=$1,updated_at=now() WHERE key=$2",[JSON.stringify(updatedPayload),it.key]);
    console.log(`✓ Saldos atualizados em ${it.key}`);
   }
  }

  // 3. Identificar IDs das contas bancárias
  let nubankAccId='8a4abeb7-4e0f-414d-8fac-e248cb8a9c17';
  let interAccId='af56cbb4-92b7-482c-a676-93830e2c26fa';

  for(const item of items){
   for(const acc of item.payload?.accounts||[]){
    if(acc.type==='BANK'){
     if(acc.bank==='Nubank'||acc.name?.toLowerCase().includes('nu pagamentos'))nubankAccId=acc.id;
     if(acc.bank==='Banco Inter'||acc.name?.toLowerCase().includes('inter'))interAccId=acc.id;
    }
   }
  }

  // Helper para mesclar transações preservando dados reais
  async function mergeTransactions(key,newTxList){
   const current=(await pool.query('SELECT payload FROM finance_snapshots WHERE key=$1',[key])).rows[0];
   const existingTx=current?.payload?.transactions||[];
   const filtered=existingTx.filter(t=>!newTxList.some(n=>n.id===t.id));
   const merged=[...newTxList,...filtered];
   const payload={transactions:merged,time_zone:'America/Sao_Paulo'};
   await pool.query('INSERT INTO finance_snapshots(key,payload,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[key,JSON.stringify(payload)]);
   const attemptKey='attempt:'+key;
   await pool.query('INSERT INTO finance_snapshots(key,payload,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[attemptKey,JSON.stringify({state:'ok'})]);
   console.log(`✓ Gravadas ${newTxList.length} transações mock em ${key} (total=${merged.length})`);
  }

  // Helper para mesclar vendas preservando dados reais
  async function mergeSales(key,newSalesList){
   const current=(await pool.query('SELECT payload FROM finance_snapshots WHERE key=$1',[key])).rows[0];
   const existingSales=current?.payload?.sales||[];
   const filtered=existingSales.filter(s=>!newSalesList.some(n=>n.id===s.id));
   const merged=[...newSalesList,...filtered];
   const payload={sales:merged,time_zone:'America/Sao_Paulo'};
   await pool.query('INSERT INTO finance_snapshots(key,payload,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[key,JSON.stringify(payload)]);
   const attemptKey='attempt:'+key;
   await pool.query('INSERT INTO finance_snapshots(key,payload,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[attemptKey,JSON.stringify({state:'ok'})]);
   console.log(`✓ Gravadas ${newSalesList.length} vendas mock em ${key} (total=${merged.length})`);
  }

  // Gravar Transações Bancárias (Setembro e Agosto)
  await mergeTransactions(`transactions:${nubankAccId}:2026-09`,mockTransactionsNubankSep);
  await mergeTransactions(`transactions:${nubankAccId}:2026-08`,mockTransactionsNubankAug);
  await mergeTransactions(`transactions:${interAccId}:2026-09`,mockTransactionsInterSep);
  await mergeTransactions(`transactions:${interAccId}:2026-08`,mockTransactionsInterAug);

  // Gravar Vendas Gateways (Stripe e Asaas - Setembro e Agosto)
  await mergeSales('sales:stripe:2026-09',mockStripeSalesSep);
  await mergeSales('sales:stripe:2026-08',mockStripeSalesAug);
  await mergeSales('sales:asaas:2026-09',mockAsaasSalesSep);
  await mergeSales('sales:asaas:2026-08',mockAsaasSalesAug);

  console.log('\n✅ Todos os dados mock (Agosto, Setembro, Saldos, Stripe e Asaas) foram inseridos com sucesso!');
  console.log('Filtros prontos para teste na prática:');
  console.log('- Ano: 2026 (curva contínua entre Agosto e Setembro no gráfico e totais unificados)');
  console.log('- Mês: 2026-09 ou 2026-08');
  console.log('- Dia: 2026-09-01, 2026-09-02, 2026-08-05, etc.');
  console.log('- Personalizado: intervalo ex.: 2026-08-01 a 2026-09-03');
  console.log('\nPara remover absolutamente todos os dados mock e restaurar os saldos exatos de antes:');
  console.log('npm run finance:clean-mock');
 }catch(err){
  console.error('Erro ao inserir dados mock:',err);
  process.exitCode=1;
 }finally{
  await pool?.end();
 }
}

seed();
