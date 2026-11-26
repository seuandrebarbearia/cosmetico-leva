import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, sqlitePath } from '../banco.js';

const baseFields = ['id', 'created_at', 'customer', 'whatsapp', 'items', 'total', 'request_id'];
const optionalFields = ['account_email', 'delivery_address', 'read_at', 'status', 'status_history', 'carrier', 'tracking', 'mail_status', 'mail_attempt_at'];
const immutable = [...baseFields, 'account_email', 'delivery_address'];
let db;

try {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL para o destino PostgreSQL.');
  const source = new DatabaseSync(process.argv[2] ? resolve(process.argv[2]) : sqlitePath(), { readOnly: true, timeout: 5000 });
  let orders;
  let accounts = new Map();
  try {
    source.exec('BEGIN');
    const columns = new Set(source.prepare('PRAGMA table_info(pedidos)').all().map(row => row.name));
    if (!baseFields.every(field => columns.has(field))) throw new Error('O arquivo SQLite não contém a tabela de pedidos esperada.');
    const selection = [...baseFields, ...optionalFields.filter(field => columns.has(field))];
    orders = source.prepare(`SELECT ${selection.join(', ')} FROM pedidos ORDER BY id`).all();
    const accountColumns = new Set(source.prepare('PRAGMA table_info(clientes)').all().map(row => row.name));
    if (accountColumns.has('cpf') && accountColumns.has('pin_hash')) {
      const profiles = source.prepare(`SELECT email, cpf, pin_hash FROM clientes
        WHERE EXISTS (SELECT 1 FROM pedidos WHERE account_email = clientes.email)`).all();
      accounts = new Map(profiles.map(account => [account.email, account]));
    }
  } finally {
    source.close();
  }

  db = await openDatabase();
  const connection = await db.connect();
  let imported = 0;
  try {
    await connection.query('BEGIN');
    await connection.query('LOCK TABLE pedidos IN ACCESS EXCLUSIVE MODE');
    const fields = [...baseFields, ...optionalFields];
    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    for (const sourceRow of orders) {
      const order = Object.assign({ ...Object.fromEntries(optionalFields.map(field => [field, null])),
        read_at: sourceRow.created_at, status: 'recebido', status_history: '[]' }, sourceRow);
      if (order.account_email) {
        const account = accounts.get(order.account_email);
        await connection.query(`INSERT INTO clientes (email, cpf, pin_hash) VALUES ($1, $2, $3)
          ON CONFLICT (email) DO UPDATE SET cpf = COALESCE(clientes.cpf, excluded.cpf),
          pin_hash = COALESCE(clientes.pin_hash, excluded.pin_hash)`, [order.account_email, account?.cpf ?? null, account?.pin_hash ?? null]);
      }
      const result = await connection.query(`INSERT INTO pedidos (${fields.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, fields.map(field => order[field]));
      if (result.rowCount) {
        imported++;
        continue;
      }
      const { rows: [existing] } = await connection.query(`SELECT ${immutable.join(', ')} FROM pedidos WHERE id = $1`, [order.id]);
      if (!existing || immutable.some(field => existing[field] !== order[field])) {
        throw new Error(`Conflito no pedido nº ${order.id}. O destino foi preservado. Importe antes de receber pedidos na Neon.`);
      }
    }

    if (imported) {
      const { rows: [maximum] } = await connection.query('SELECT MAX(id) AS id FROM pedidos');
      const { rows: [identity] } = await connection.query('SELECT last_value, is_called FROM pedidos_id_seq');
      const next = Math.max(maximum.id + 1, Number(identity.last_value) + Number(identity.is_called));
      await connection.query(`ALTER TABLE pedidos ALTER COLUMN id RESTART WITH ${next}`);
    }
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
  console.log(`${imported} pedido(s) importado(s), ${orders.length - imported} já existente(s). SQLite mantido em modo somente leitura.`);
} catch (error) {
  console.error('Falha na importação:', error.code === '42P01' ? 'Execute npm run db:migrate no destino antes de importar.' : error.code || error.message);
  process.exitCode = 1;
} finally {
  await db?.end();
}
