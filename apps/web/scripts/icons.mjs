// Membuat ikon PWA dari logo SIAGA (sama dengan logo di header prototipe).
// Jalankan: pnpm --filter @siaga/web icons  (butuh sharp dari apps/server)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const sharp = require('sharp');

const mark = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${28 + pad * 2} ${28 + pad * 2}">
  <rect x="${-pad}" y="${-pad}" width="${28 + pad * 2}" height="${28 + pad * 2}" fill="#06161f"/>
  <circle cx="14" cy="14" r="12.5" fill="none" stroke="#f1f5f2" stroke-opacity=".28"/>
  <circle cx="14" cy="14" r="7.5" fill="none" stroke="#f1f5f2" stroke-opacity=".55"/>
  <path d="M14 14 23 5.5" stroke="#f1f5f2" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="14" cy="14" r="2.6" fill="#f1f5f2"/>
  <circle cx="20.2" cy="18.6" r="1.7" fill="#ff7a9c"/>
</svg>`;

const out = new URL('../public/icons/', import.meta.url);
writeFileSync(new URL('icon.svg', out), mark(4));
for (const [name, size, pad] of [['icon-192.png', 192, 4], ['icon-512.png', 512, 4], ['maskable-512.png', 512, 10], ['apple-touch-icon.png', 180, 5], ['badge-96.png', 96, 2]]) {
  await sharp(Buffer.from(mark(pad))).resize(size, size).png().toFile(new URL(name, out).pathname);
  console.log(name);
}
