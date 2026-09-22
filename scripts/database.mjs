import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function databaseConfig() {
  let url = process.env.DATABASE_URL || 'file:./dev.db';
  if (url.startsWith('file:')) url = `file:${path.resolve(root, 'prisma', url.slice(5)).replaceAll('\\', '/')}`;
  return { url, authToken: process.env.TURSO_AUTH_TOKEN };
}
export function databaseClient() { return createClient(databaseConfig()); }
