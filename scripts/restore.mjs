import fs from 'node:fs/promises';
import { databaseClient } from './database.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: npm run db:restore -- path/to/backup.json (only restores into an empty, migrated database)');
const backup = JSON.parse(await fs.readFile(file, 'utf8'));
if (backup.format !== 'nour-study-backup' || backup.version !== 1) throw new Error('Unsupported backup format.');
const fields = {
  Session: ['id', 'title', 'category', 'createdAt', 'updatedAt', 'ownerId', 'mode'],
  Message: ['id', 'sessionId', 'role', 'content', 'createdAt', 'turnId', 'status', 'sources'],
  ExamAttempt: ['id', 'ownerId', 'category', 'questions', 'answers', 'sources', 'revision', 'startedAt', 'expiresAt', 'submittedAt', 'score'],
};
const client = databaseClient();
let transaction;
try {
  await client.execute('PRAGMA foreign_keys = ON');
  transaction = await client.transaction('write');
  for (const name of Object.keys(fields)) {
    const count = await transaction.execute(`SELECT COUNT(*) AS count FROM "${name}"`);
    if (Number(count.rows[0].count) !== 0) throw new Error('Restore refused: the destination contains study data. Use a new empty database.');
  }
  for (const [name, columns] of Object.entries(fields)) {
    const rows = backup.tables?.[name];
    if (!Array.isArray(rows)) throw new Error(`Missing ${name} rows.`);
    for (const row of rows) {
      if (!row || columns.some(key => !(key in row)) || Object.keys(row).some(key => !columns.includes(key))) throw new Error(`Invalid ${name} row.`);
      const args = columns.map(key => row[key]);
      if (args.some(value => value !== null && !['string', 'number'].includes(typeof value))) throw new Error('Invalid backup value.');
      await transaction.execute({ sql: `INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`, args });
    }
  }
  await transaction.commit();
  console.log('Study data restored. Login sessions and request quotas are not restored.');
} catch (error) {
  await transaction?.rollback();
  console.error('Restore failed:', error instanceof Error ? error.message : 'Unknown error'); process.exitCode = 1;
} finally { transaction?.close(); client.close(); }
