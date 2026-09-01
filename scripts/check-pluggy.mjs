// Read-only diagnostic: no balances, transactions, credentials or IDs in output.
import { pluggyItemIds } from '../apps/api/src/integrations/pluggy-config.mjs';

async function check() {
  const ids = pluggyItemIds();
  if (!ids.length) throw new Error('Preencha PLUGGY_ITEM_IDS no .env com os IDs separados por vírgula.');
  if (!process.env.PLUGGY_CLIENT_ID || !process.env.PLUGGY_CLIENT_SECRET) {
    throw new Error('Configure as credenciais Pluggy no .env do backend.');
  }
  const options = () => ({redirect:'error', signal:AbortSignal.timeout(15000)});
  const auth = await fetch('https://api.pluggy.ai/auth', {
    ...options(), method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({clientId:process.env.PLUGGY_CLIENT_ID, clientSecret:process.env.PLUGGY_CLIENT_SECRET})
  });
  if (!auth.ok) throw new Error(`Autenticação Pluggy: HTTP ${auth.status}.`);
  const {apiKey} = await auth.json();
  if (!apiKey) throw new Error('Autenticação sem chave de acesso.');
  for (const [index, id] of ids.entries()) {
    try {
      const response = await fetch(`https://api.pluggy.ai/items/${encodeURIComponent(id)}`, {
        ...options(), headers:{'X-API-KEY':apiKey}
      });
      console.log(`Conexão ${index + 1}: HTTP ${response.status}${response.ok ? ' — acessível' : ' — verificar autorização'}`);
      if (!response.ok) process.exitCode = 1;
      await response.body?.cancel();
    } catch {
      console.log(`Conexão ${index + 1}: falha de rede ou tempo limite.`);
      process.exitCode = 1;
    }
  }
}
check().catch(error => {
  console.error(error instanceof TypeError ? 'Falha na comunicação com a Pluggy.' : error.message);
  process.exitCode = 1;
});
