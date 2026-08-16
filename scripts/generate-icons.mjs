/**
 * Genera los iconos PWA desde icon.svg (requiere las dependencias del proyecto).
 * Uso: node scripts/generate-icons.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const svg = await fs.readFile(path.join(root, 'public', 'icon.svg'), 'utf8');

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-192.png', size: 192, pad: 1.25 },
  { file: 'icon-maskable-512.png', size: 512, pad: 1.25 },
  { file: 'apple-touch-icon.png', size: 180, pad: 1.0 },
  { file: 'favicon.png', size: 48 },
];

const sharp = (await import('sharp')).default;

for (const target of targets) {
  const svgBuffer = Buffer.from(svg);
  let pipeline = sharp(svgBuffer, { density: 300 });
  if (target.pad && target.pad > 1) {
    pipeline = pipeline.resize(target.size, target.size, { fit: 'contain', background: '#B05C78' });
  } else {
    pipeline = pipeline.resize(target.size, target.size);
  }
  await pipeline.png().toFile(path.join(root, 'public', target.file));
  console.log('✓', target.file);
}
