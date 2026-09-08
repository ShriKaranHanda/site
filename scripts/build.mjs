import { cp, mkdir, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await rm(output, { recursive: true, force: true });
await mkdir(new URL('scripts/', output), { recursive: true });

// Publish only website assets, keeping development files out of the deployment.
for (const path of [
  'index.html', 'styles.css', 'around', 'contact', 'past', 'press',
  'images', 'xp', 'scripts/favicons.js',
]) {
  await cp(new URL(path, root), new URL(path, output), { recursive: true });
}
