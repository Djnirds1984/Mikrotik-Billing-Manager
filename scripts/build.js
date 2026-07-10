// Build script that ensures adequate heap for Vite production builds
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Forward all CLI args to vite (e.g. --mode, --debug, etc.)
const viteArgs = ['node_modules/vite/bin/vite.js', 'build', ...process.argv.slice(2)];

const child = spawn(process.execPath, viteArgs, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: `--max-old-space-size=4096 ${process.env.NODE_OPTIONS || ''}`.trim(),
  },
});

child.on('exit', (code) => process.exit(code ?? 1));
