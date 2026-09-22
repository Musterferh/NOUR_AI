import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

test('versioned migrations preserve legacy data and backups restore only into empty databases', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nour-database-workflow-'));
  const source = path.join(folder, 'source.db');
  const destination = path.join(folder, 'restored.db');
  const env = (file: string) => ({ ...process.env, DATABASE_URL: `file:${file.replaceAll('\\', '/')}`, TURSO_AUTH_TOKEN: '' });
  const run = (script: string, file: string, args: string[] = []) => spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', script), ...args], { env: env(file), encoding: 'utf8' });
  // Run the native libSQL driver in a child process so Windows file handles are
  // released before inspecting or cleaning up the database files.
  const query = (file: string, statements: Array<string | { sql: string; args: Array<string | number> }>) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { createClient } from '@libsql/client';
      import fs from 'node:fs';
      const client = createClient({url:process.env.DATABASE_URL});
      const results=[];
      for(const statement of JSON.parse(fs.readFileSync(0,'utf8'))) results.push((await client.execute(statement)).rows);
      client.close();
      console.log(JSON.stringify(results));
    `], { env: env(file), encoding: 'utf8', input: JSON.stringify(statements) });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as Array<Array<Record<string, string | number | null>>>;
  };
  const backupFiles: string[] = [];
  t.after(async () => {
    for (const file of [source, destination]) for (const suffix of ['', '-journal', '-wal', '-shm']) await fs.rm(`${file}${suffix}`, { force: true });
    for (const file of backupFiles) await fs.rm(file, { force: true });
    await fs.rmdir(folder);
  });
  const initial = await fs.readFile(path.join(process.cwd(), 'prisma', 'migrations', '001_initial.sql'), 'utf8');
  query(source, [...initial.split(';').map(s => s.trim()).filter(Boolean),
    { sql: 'INSERT INTO Session (id,title,category,updatedAt) VALUES (?,?,?,?)', args: ['legacy-session', 'Previous study', 'Spectrum', '2026-01-01T00:00:00.000Z'] },
    { sql: 'INSERT INTO Message (id,sessionId,role,content) VALUES (?,?,?,?)', args: ['legacy-message', 'legacy-session', 'user', 'Remember this study note.'] },
  ]);
  const migration = run('migrate.mjs', source);
  assert.equal(migration.status, 0, migration.stderr);
  const again = run('migrate.mjs', source);
  assert.equal(again.status, 0, again.stderr);
  const verified = query(source, ['SELECT ownerId FROM Session', 'SELECT content,turnId FROM Message']);
  assert.equal(verified[0][0].ownerId, 'private');
  assert.equal(verified[1][0].content, 'Remember this study note.');
  const backup = run('backup.mjs', source);
  assert.equal(backup.status, 0, backup.stderr);
  const backupFile = backup.stdout.trim().replace('Saved private study backup: ', '');
  backupFiles.push(backupFile);
  const snapshot = JSON.parse(await fs.readFile(backupFile, 'utf8'));
  assert.deepEqual(Object.keys(snapshot.tables), ['Session', 'Message', 'ExamAttempt']);
  assert.equal(run('migrate.mjs', destination).status, 0);
  const restored = run('restore.mjs', destination, [backupFile]);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(query(destination, ['SELECT content FROM Message'])[0][0].content, 'Remember this study note.');
  assert.equal(run('restore.mjs', destination, [backupFile]).status, 1, 'A populated target must not be overwritten');
  assert.equal(Number(query(destination, ['SELECT COUNT(*) AS count FROM Message'])[0][0].count), 1);
});
