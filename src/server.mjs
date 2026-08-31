// Ponto de entrada do bootstrap local. A composição vive em src/app.mjs;
// createCore continua exportado daqui para os testes e para embutir o Core.
import { pathToFileURL } from 'node:url';
import { createCore } from './app.mjs';
import { openDatabase, transportWarning } from './platform/database.mjs';

export { createCore };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 if (process.env.NODE_ENV === 'production')
  throw new Error('Local bootstrap only. Configure real identity before deployment.');

 const { pool, security } = await openDatabase({
  connectionString: process.env.DATABASE_URL,
  mode: process.env.DATABASE_SSL || 'allow',
  max: 5,
  connectionTimeoutMillis: 8000,
 });

 const warning = transportWarning(security);
 if (warning) console.warn(warning);

 const server = createCore({ pool, adminPassword: process.env.CORE_ADMIN_PASSWORD, security });
 server.listen(Number(process.env.PORT || 3100), '127.0.0.1',
  () => console.log(`TZOLKIN Core: http://127.0.0.1:${server.address().port} (local only)`));
}
