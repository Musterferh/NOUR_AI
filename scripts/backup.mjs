import fs from 'node:fs/promises';
import path from 'node:path';
import { databaseClient, root } from './database.mjs';

const client = databaseClient();
try {
  const folder = path.join(root, 'backups');
  await fs.mkdir(folder, { recursive: true });
  const transaction = await client.transaction('read');
  const tables = {};
  try {
    for (const name of ['Session', 'Message', 'ExamAttempt']) tables[name] = (await transaction.execute(`SELECT * FROM "${name}"`)).rows;
    await transaction.commit();
  } finally { transaction.close(); }
  const file = path.join(folder, `nour-${new Date().toISOString().replaceAll(':', '-')}.json`);
  await fs.writeFile(file, JSON.stringify({ format: 'nour-study-backup', version: 1, createdAt: new Date().toISOString(), tables }, (_, value) => typeof value === 'bigint' ? Number(value) : value, 2), { flag: 'wx', mode: 0o600 });
  console.log(`Saved private study backup: ${file}`);
} catch (error) { console.error('Backup failed:', error instanceof Error ? error.message : 'Unknown error'); process.exitCode = 1; }
finally { client.close(); }
