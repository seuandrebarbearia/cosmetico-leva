import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const postgres = Boolean(process.env.DATABASE_URL);
const dialect = postgres ? 'postgres' : 'sqlite';
const migrations = [`001-${dialect}.sql`, '002-pedidos-contas.sql', '003-confirmacao-email.sql'];
const currentVersion = migrations.length;
const migrationSql = name => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
export const sqlitePath = () => process.env.DB_PATH === ':memory:' ? ':memory:' : resolve(process.env.DB_PATH || 'data/pedidos.sqlite');

export async function openDatabase() {
  if (postgres) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, enableChannelBinding: true, connectionTimeoutMillis: 10_000 });
    pool.on('error', error => console.error('Conexão PostgreSQL interrompida:', error.code || error.name));
    return pool;
  }
  const path = sqlitePath();
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path, { timeout: 5000 });
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return sqlite;
}

export async function migrate(db) {
  const prepare = 'CREATE TABLE IF NOT EXISTS migracoes (version INTEGER PRIMARY KEY)';
  if (postgres) {
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT pg_advisory_xact_lock(14013723)');
      await connection.query(prepare);
      const { rows } = await connection.query('SELECT version FROM migracoes');
      const applied = new Set(rows.map(row => row.version));
      for (const [index, name] of migrations.entries()) {
        if (applied.has(index + 1)) continue;
        await connection.query(migrationSql(name));
        await connection.query('INSERT INTO migracoes (version) VALUES ($1)', [index + 1]);
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(prepare);
    const applied = new Set(db.prepare('SELECT version FROM migracoes').all().map(row => row.version));
    for (const [index, name] of migrations.entries()) {
      if (applied.has(index + 1)) continue;
      db.exec(migrationSql(name));
      db.prepare('INSERT INTO migracoes (version) VALUES (?)').run(index + 1);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function orderDatabase() {
  const db = await openDatabase();
  if (!postgres) await migrate(db);
  else {
    try {
      const { rowCount } = await db.query('SELECT version FROM migracoes WHERE version = $1', [currentVersion]);
      if (!rowCount) throw new Error('Migração pendente');
    } catch (error) {
      await db.end();
      throw new Error(`Não foi possível inicializar o PostgreSQL (${error.code || 'verifique a configuração'}). Confira DATABASE_URL e execute npm run db:migrate.`);
    }
  }

  const run = connection => async (sql, ...values) => {
    if (!postgres) return connection.prepare(sql).all(...values);
    let index = 0;
    const { rows } = await connection.query(sql.replaceAll('?', () => `$${++index}`), values);
    return rows;
  };
  const direct = run(db);
  let queue = Promise.resolve();
  function serialize(work) {
    const pending = queue.then(work);
    queue = pending.catch(() => {});
    return pending;
  }
  const query = postgres ? direct : (...args) => serialize(() => direct(...args));
  query.transaction = postgres ? async work => {
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const result = await work(run(connection));
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  } : work => serialize(async () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = await work(direct);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  return query;
}
