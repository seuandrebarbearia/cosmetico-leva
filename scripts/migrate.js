import { migrate, openDatabase } from '../banco.js';

let db;
try {
  db = await openDatabase();
  await migrate(db);
  console.log(`Migrações aplicadas em ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'}.`);
} catch (error) {
  console.error('Falha na migração:', error.code || error.message);
  process.exitCode = 1;
} finally {
  if (db?.end) await db.end();
  else db?.close();
}
