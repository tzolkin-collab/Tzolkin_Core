// Reads metadata by default; --refresh-current imports the current local month.
// No credentials, account identifiers or financial values in output.
import {openDatabase} from '../apps/api/src/platform/database.mjs';
import {financeRoutes} from '../apps/api/src/modules/finance.mjs';
import {brazilMonth} from '../apps/web/public/finance-model.js';
let pool;
try{
 ({pool}=await openDatabase({connectionString:process.env.DATABASE_URL,mode:'require',max:1}));
 const routes=new Map(),refresh=process.argv.includes('--refresh-current');
 financeRoutes({get:(path,handler)=>routes.set(path,handler),post:(path,handler)=>routes.set('POST '+path,handler)},refresh?{}:{provider:{accounts(){throw Error('No provider reads allowed');},transactions(){throw Error('No provider reads allowed');}}});
 let board;await routes.get('/api/finance/board')({pool,url:new URL('http://local/api/finance/board?month='+brazilMonth(Date.now())),reply:(status,body)=>{board=body;console.log('board_status='+status);}});
 if(refresh){
  for(const [index,account]of board.accounts.entries()){
   const req={headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({account_id:account.id,month:board.month}));}};
   try{await routes.get('POST /api/finance/transactions/sync')({pool,req,reply:(status,result)=>{account.snapshot=result.snapshot;console.log(JSON.stringify({account:index+1,status,rows:result.snapshot.payload.transactions.length}));}});}
   catch{console.log(JSON.stringify({account:index+1,status:'failed_previous_preserved'}));process.exitCode=1;}
  }
 }
 console.log(JSON.stringify({accounts:board.accounts.length,saved_statements:board.accounts.filter(a=>a.snapshot).length,rows:board.accounts.reduce((n,a)=>n+(a.snapshot?.payload.transactions.length||0),0),saved_months:board.saved_months}));
}catch{console.log('Falha na leitura segura dos dados salvos.');process.exitCode=1;}
finally{await pool?.end();}
