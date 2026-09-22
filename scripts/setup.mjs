import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, '.env.local');
try {
  const example = await fs.readFile(path.join(root, '.env.example'), 'utf8');
  const content = example.replace(/^APP_ACCESS_PASSWORD=.*$/m, `APP_ACCESS_PASSWORD=${randomBytes(18).toString('base64url')}`).replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET=${randomBytes(32).toString('base64url')}`);
  await fs.writeFile(destination, content, { flag: 'wx', mode: 0o600 });
  console.log('Created .env.local with a unique private password and signing secret.');
  console.log('Open .env.local to find APP_ACCESS_PASSWORD and add KIMI_API_KEY; OPENAI_API_KEY enables optional voice.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env.local already exists and was preserved.');
  else throw error;
}
