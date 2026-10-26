import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { applyMigrations } from '../../scripts/migrate.mjs';

const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);

test('migrações: lint contra BEGIN/COMMIT e regras de numeração', async t => {
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  assert.ok(files.length > 50, 'deve haver mais de 50 migrações registradas');

  await t.test('nenhum arquivo .sql deve conter BEGIN, COMMIT ou ROLLBACK manuais', () => {
    // migrate.mjs é o único dono da transação. Um COMMIT ou BEGIN dentro do .sql
    // quebraria o isolamento e impediria rollback em caso de falha.
    for (const file of files) {
      const content = readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/--.*$/, '').trim(); // remove comentários de linha
        assert.ok(
          !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*(WORK|TRANSACTION)?\s*;/i.test(line),
          `Migração ${file}:${i + 1} possui comando de transação manual (${line}). O controle deve ser feito exclusivamente por migrate.mjs.`
        );
      }
    }
  });

  await t.test('padrão de nomenclatura das migrações segue ddd_nome.sql', () => {
    for (const file of files) {
      assert.match(
        file,
        /^\d{3}_[a-z0-9_]+\.sql$/,
        `Nome de arquivo de migração inválido: ${file}. Deve seguir o padrão 000_nome_da_migracao.sql`
      );
    }
  });

  await t.test('numeração de migrações: sem duplicações além do caso histórico 015', () => {
    const prefixes = new Map();
    for (const file of files) {
      const num = file.slice(0, 3);
      if (!prefixes.has(num)) prefixes.set(num, []);
      prefixes.get(num).push(file);
    }

    for (const [num, list] of prefixes) {
      if (num === '015') {
        // Exceção histórica documentada em docs/handoff-2026-09-14-core-estado-atual.md
        assert.equal(list.length, 2, 'Caso histórico 015 deve conter exatamente os 2 arquivos conhecidos');
        assert.deepEqual(list.sort(), ['015_commercial_intake.sql', '015_e9_produto_draft.sql']);
      } else {
        assert.equal(
          list.length,
          1,
          `Prefixo duplicado encontrado para ${num}: ${list.join(', ')}. Cada migração nova deve ter numeração monotônica única.`
        );
      }
    }
  });
});

test('applyMigrations: falha injetada executa ROLLBACK e não grava na tabela de migrações', async () => {
  const log = [];
  const appliedMigrations = new Set();

  const fakeClient = {
    async query(sql, params) {
      const cmd = sql.trim().split(/\s+/).slice(0, 2).join(' ').toUpperCase();
      log.push({ cmd, sql, params });

      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return { rows: [] };
      }

      if (sql.includes('SELECT id FROM schema_migrations')) {
        return { rows: Array.from(appliedMigrations).map(id => ({ id })) };
      }

      if (cmd === 'BEGIN') return { rows: [] };
      if (cmd === 'ROLLBACK') return { rows: [] };
      if (cmd === 'COMMIT') return { rows: [] };

      if (cmd === 'INSERT INTO' && sql.includes('schema_migrations')) {
        appliedMigrations.add(params[0]);
        return { rowCount: 1 };
      }

      // Injeta falha quando executa o script da migração
      throw new Error('Falha injetada para teste de atomicidade da migração');
    },
  };

  const logs = [];
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));

  try {
    const success = await applyMigrations(fakeClient, msg => logs.push(msg));
    assert.equal(success, false, 'applyMigrations deve retornar false quando uma migração falha');
  } finally {
    console.error = originalError;
  }

  // Verifica que o rollback foi disparado
  const rollbackCalled = log.some(q => q.cmd === 'ROLLBACK');
  assert.ok(rollbackCalled, 'ROLLBACK deve ser chamado quando uma migração falha');

  // Verifica que nada foi gravado em schema_migrations após o erro
  assert.equal(appliedMigrations.size, 0, 'Nenhuma migração deve ser registrada como aplicada em caso de erro');
  assert.ok(errors.some(e => e.includes('falhou em') && e.includes('Falha injetada')));
});

test('regex nas migrações: nenhuma repetição acima de 255 (o PostgreSQL recusa, mas só ao avaliar um valor não nulo)', () => {
  // Exceção histórica: a 038 criou {10,500} no fbc e a 069 a substituiu. Outra migração com repetição > 255 reproduz o mesmo 500 em produção.
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql') && f !== '038_atribuicao_estendida.sql');
  for (const file of files) {
    const content = readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8').replace(/--.*$/gm, '');
    for (const m of content.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
      const maior = Math.max(Number(m[1]), m[2] ? Number(m[2]) : 0);
      assert.ok(maior <= 255, `Migração ${file} tem repetição ${m[0]} (> 255): o PostgreSQL recusa ao avaliar o regex.`);
    }
  }
  const nova = readFileSync(new URL('069_fbc_regex_limite_postgres.sql', MIGRATIONS_DIR), 'utf8');
  assert.match(nova, /\{10,255\}/);
  assert.doesNotMatch(nova.replace(/--.*$/gm, ''), /\{10,500\}/);
});
