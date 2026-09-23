import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Load the environment in this parent process, then launch Next without the
// env-file argument. Next forwards its execArgv to NODE_OPTIONS when forking
// the development server, where Node does not permit --env-file-if-exists.
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { if (!child.killed) child.kill(signal); });
}
child.on('error', () => { console.error('Could not start Next.js. Check your Node installation.'); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
