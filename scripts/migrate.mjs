import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { databaseClient, root } from './database.mjs';

const client = databaseClient();
try {
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute('CREATE TABLE IF NOT EXISTS "_nour_migrations" ("name" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL, "appliedAt" TEXT NOT NULL)');
  const folder = path.join(root, 'prisma', 'migrations');
  for (const name of (await fs.readdir(folder)).filter(n => n.endsWith('.sql')).sort()) {
    const sql = (await fs.readFile(path.join(folder, name), 'utf8')).replaceAll('\r\n', '\n');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = await client.execute({ sql: 'SELECT checksum FROM "_nour_migrations" WHERE name = ?', args: [name] });
    if (applied.rows.length) {
      if (applied.rows[0].checksum !== checksum) throw new Error(`Migration ${name} changed after application. Restore the original migration.`);
      continue;
    }
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    await client.batch([...statements, { sql: 'INSERT INTO "_nour_migrations" (name, checksum, appliedAt) VALUES (?, ?, ?)', args: [name, checksum, new Date().toISOString()] }], 'write');
    console.log(`Applied ${name}`);
  }
  console.log('Database migrations completed.');
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
} finally { client.close(); }
