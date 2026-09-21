// Copies the installed three.js build into vendor/ so the game also runs from
// static hosting (GitHub Pages), where node_modules does not exist.
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/three/build/three.module.js');
const dest = resolve(root, 'vendor/three.module.js');

if (!existsSync(src)) {
  console.log('[vendor] three.js not installed yet; keeping the committed copy');
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log('[vendor] three.module.js updated');
