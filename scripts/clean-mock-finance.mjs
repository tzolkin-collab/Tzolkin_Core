// Cleans all mock financial data (bank transactions, gateway sales, and restores original balances)
// from finance_snapshots.
// Removes every record where id starts with 'mock-' or is_mock is true.

import {openDatabase} from '../apps/api/src/platform/database.mjs';

async function clean(){
 let pool;
 try{
  ({pool}=await openDatabase({connectionString:process.env.DATABASE_URL,mode:'require',max:1}));
  console.log('Conectado ao banco para remoção total de dados sintéticos de teste...');

  // 1. Restaurar saldos originais das contas se houver backup
  const backupRow=(await pool.query("SELECT payload FROM finance_snapshots WHERE key='meta:mock_balances_backup'")).rows[0];
  if(backupRow?.payload){
   const balanceBackup=backupRow.payload;
   for(const [itemKey,savedAccounts]of Object.entries(balanceBackup)){
    const itemRow=(await pool.query('SELECT payload FROM finance_snapshots WHERE key=$1',[itemKey])).rows[0];
    if(itemRow?.payload?.accounts){
     const restoredAccounts=itemRow.payload.accounts.map(acc=>{
      const match=savedAccounts.find(s=>s.id===acc.id);
      return match?{...acc,balance:match.balance}:acc;
     });
     await pool.query('UPDATE finance_snapshots SET payload=$1,updated_at=now() WHERE key=$2',[{...itemRow.payload,accounts:restoredAccounts},itemKey]);
     console.log(`✓ Saldos originais restaurados em ${itemKey}`);
    }
   }
   await pool.query("DELETE FROM finance_snapshots WHERE key='meta:mock_balances_backup'");
   console.log('✓ Backup de saldos concluído e removido.');
  }

  let removedTxCount=0,removedSalesCount=0;

  // 2. Limpar transações bancárias (de todos os meses, incluindo agosto e setembro)
  const txRows=(await pool.query("SELECT key, payload FROM finance_snapshots WHERE key LIKE 'transactions:%'")).rows;
  for(const row of txRows){
   const txList=row.payload?.transactions||[];
   const nonMock=txList.filter(t=>!(String(t.id).startsWith('mock-')||t.is_mock===true));
   const diff=txList.length-nonMock.length;
   if(diff>0){
    removedTxCount+=diff;
    const newPayload={...row.payload,transactions:nonMock};
    await pool.query('UPDATE finance_snapshots SET payload=$1,updated_at=now() WHERE key=$2',[JSON.stringify(newPayload),row.key]);
    console.log(`✓ Removidas ${diff} transações mock de ${row.key} (restantes: ${nonMock.length})`);
   }
  }

  // 3. Limpar vendas dos gateways (de todos os meses, incluindo agosto e setembro)
  const salesRows=(await pool.query("SELECT key, payload FROM finance_snapshots WHERE key LIKE 'sales:%' AND key NOT LIKE 'attempt:%'")).rows;
  for(const row of salesRows){
   const salesList=row.payload?.sales||[];
   const nonMock=salesList.filter(s=>!(String(s.id).startsWith('mock-')||s.is_mock===true));
   const diff=salesList.length-nonMock.length;
   if(diff>0){
    removedSalesCount+=diff;
    const newPayload={...row.payload,sales:nonMock};
    await pool.query('UPDATE finance_snapshots SET payload=$1,updated_at=now() WHERE key=$2',[JSON.stringify(newPayload),row.key]);
    console.log(`✓ Removidas ${diff} vendas mock de ${row.key} (restantes: ${nonMock.length})`);
   }
  }

  console.log(`\n✅ Limpeza completa concluída com sucesso:`);
  console.log(`- ${removedTxCount} transações bancárias mock removidas`);
  console.log(`- ${removedSalesCount} vendas mock de gateways removidas`);
  console.log(`- Saldos originais das contas restaurados com precisão.`);
 }catch(err){
  console.error('Erro ao limpar dados mock:',err);
  process.exitCode=1;
 }finally{
  await pool?.end();
 }
}

clean();
