import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';

test('certificado do PostgreSQL: validade, identidade e alerta de expiração', async t => {
  const certPath = path.resolve('certs/postgres-server.crt');
  assert.ok(fs.existsSync(certPath), 'certs/postgres-server.crt deve existir no repositório');

  const raw = fs.readFileSync(certPath);
  const cert = new X509Certificate(raw);

  await t.test('certificado é válido e não está expirado', () => {
    const validToMs = Date.parse(cert.validTo);
    const validFromMs = Date.parse(cert.validFrom);
    const now = Date.now();

    assert.ok(Number.isFinite(validToMs), 'validTo deve ser uma data válida');
    assert.ok(Number.isFinite(validFromMs), 'validFrom deve ser uma data válida');
    assert.ok(validFromMs <= now, 'validFrom deve ser anterior ou igual ao momento atual');
    assert.ok(validToMs > now, `Certificado do Postgres expirou em ${cert.validTo}! O Core para com verify-full.`);
  });

  await t.test('guarda de renovação: alerta quando faltar menos de 90 dias para expirar', () => {
    const validToMs = Date.parse(cert.validTo);
    const now = Date.now();
    const daysRemaining = (validToMs - now) / (1000 * 60 * 60 * 24);

    if (daysRemaining < 90) {
      console.warn(`[ALERTA DE SEGURANÇA] O certificado certs/postgres-server.crt vence em ${Math.floor(daysRemaining)} dias (${cert.validTo}). Inicie o processo de renovação.`);
    }
    assert.ok(daysRemaining > 0, 'Certificado do Postgres não pode estar expirado');
  });

  await t.test('identidade e fingerprint correspondem ao servidor esperado', () => {
    assert.ok(cert.checkHost('easypanel.landcriativa.com'), 'Certificado deve atender easypanel.landcriativa.com');
    const fp = cert.fingerprint256.replaceAll(':', '').toUpperCase();
    assert.equal(fp, 'A1397C95457F0969102FE44587B1AFD47BF6B214F00F6047F6076D72A5FDCA7A', 'Fingerprint SHA-256 deve coincidir com o registrado na infraestrutura');
  });
});
