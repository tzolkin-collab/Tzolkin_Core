// Ponto de entrada do bootstrap local. A composição vive em src/app.mjs;
// createCore continua exportado daqui para os testes e para embutir o Core.
import { pathToFileURL } from 'node:url';
import { createCore } from './app.mjs';
import { iniciarJobsDaAgenda } from './modules/agenda-jobs.mjs';
import { openDatabase, transportWarning, manterPoolQuente } from './platform/database.mjs';

export { createCore };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 if (process.env.NODE_ENV === 'production')
  throw new Error('Local bootstrap only. Configure real identity before deployment.');

 const { pool, security } = await openDatabase({
  connectionString: process.env.DATABASE_URL,
  mode: process.env.DATABASE_SSL || 'require',
  max: 5,
  connectionTimeoutMillis: 8000,
  // Conexão ociosa dura 5 min (padrão: 10 s); manterPoolQuente a usa antes disso.
  idleTimeoutMillis: 300_000,
 });
 await manterPoolQuente(pool);

 const warning = transportWarning(security);
 if (warning) console.warn(warning);

 const server = createCore({ pool, adminPassword: process.env.CORE_ADMIN_PASSWORD, security,
  webOrigin: process.env.WEB_ORIGIN || 'http://127.0.0.1:3100' });
 server.listen(Number(process.env.API_PORT || 3102), '127.0.0.1',
  () => console.log(`TZOLKIN API: http://127.0.0.1:${server.address().port} (local only)`));
 // Os jobs da agenda (lembretes por push, séries sem fim) só rodam aqui se pedido: o bootstrap local usa o banco compartilhado e não deve
 // mandar aviso de verdade nem gerar ocorrências por conta própria. Em produção eles ligam sempre (production.mjs).
 const pararAgenda = process.env.AGENDA_JOBS === '1' ? iniciarJobsDaAgenda({ pool }) : () => {};
 const stop = () => { pararAgenda(); server.closeAllConnections(); server.close(() => pool.end().finally(() => process.exit(0))); };
 process.on('SIGTERM',stop); process.on('SIGINT',stop);
}
