import { createClient } from '@libsql/client';
import * as fs from 'fs';

async function main() {
  const url = process.env.DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    console.error('Missing DATABASE_URL or TURSO_AUTH_TOKEN');
    process.exit(1);
  }

  const client = createClient({ url, authToken });
  const sql = fs.readFileSync('prisma/setup.sql', 'utf-8');
  
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  
  for (const stmt of statements) {
    console.log('Executing:', stmt.split('\n')[0], '...');
    try {
      await client.execute(stmt);
      console.log('Success');
    } catch (e) {
      console.error('Error:', e.message);
    }
  }
  console.log('Schema pushed to Turso successfully!');
}
main();
