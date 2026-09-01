// Bootstrap da confiança: nenhum pacote de autenticação PostgreSQL é enviado.
// Compare o SHA-256 com o certificado lido pelo console HTTPS autenticado.
import net from 'node:net';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';

let target;
try { target = new URL(process.env.DATABASE_URL); }
catch { console.error('DATABASE_URL ausente ou inválida.'); process.exit(1); }
const expected = process.argv[2]?.replaceAll(':', '').toUpperCase();
if (!/^[A-F0-9]{64}$/.test(expected || '')) throw new Error('Informe o SHA-256 obtido pelo canal administrativo.');
const socket = net.createConnection({ host: target.hostname, port: Number(target.port || 5432) });
socket.setTimeout(8000, () => socket.destroy(new Error('Timeout no servidor.')));
socket.on('error', () => { console.error('Falha no transporte.'); process.exitCode = 1; });
socket.once('connect', () => {
 const request = Buffer.alloc(8);
 request.writeInt32BE(8, 0);
 request.writeInt32BE(80877103, 4);
 socket.write(request);
});
socket.once('data', response => {
 if (response.length !== 1 || response[0] !== 83) {
  socket.destroy(); console.error('Servidor não oferece TLS.'); process.exitCode = 1; return;
 }
 // Somente inspeciona certificado público; confiança depende do fingerprint externo.
 const secure = tls.connect({ socket, servername: target.hostname, rejectUnauthorized: false });
 secure.on('error', () => { console.error('Falha no handshake.'); process.exitCode = 1; });
 secure.once('secureConnect', () => {
  const cert = new X509Certificate(secure.getPeerCertificate().raw);
  secure.destroy();
  console.error(JSON.stringify({ fingerprint256: cert.fingerprint256, hostnameMatches: Boolean(cert.checkHost(target.hostname)), validFrom: cert.validFrom, validTo: cert.validTo }));
  if (cert.fingerprint256.replaceAll(':', '') !== expected || !cert.checkHost(target.hostname) || Date.parse(cert.validTo) <= Date.now() || Date.parse(cert.validFrom) > Date.now()) {
   console.error('Certificado recusado: identidade, fingerprint ou validade divergente.'); process.exitCode = 1; return;
  }
  console.log(cert.toString());
 });
});
