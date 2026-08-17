import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

export default function globalSetup(): void {
  execFileSync('pnpm', ['build'], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
}
