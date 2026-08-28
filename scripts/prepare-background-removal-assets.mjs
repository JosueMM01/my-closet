import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKGROUND_REMOVAL_VERSION = '1.7.0';
export const RESOURCE_KEYS = [
  '/models/isnet',
  '/models/isnet_fp16',
  '/models/isnet_quint8',
  '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
  '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
  '/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm',
  '/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs',
];

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(
  projectRoot,
  'public',
  'vendor',
  'background-removal',
  `${BACKGROUND_REMOVAL_VERSION}-adaptive-v1`,
);

function assertObject(value, description) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${description} no es un objeto`);
  }
  return value;
}

function parseResources(value) {
  const resources = assertObject(value, 'resources.json');
  const selected = {};

  for (const key of RESOURCE_KEYS) {
    const entry = assertObject(resources[key], `Recurso ${key}`);
    if (!Array.isArray(entry.chunks) || typeof entry.size !== 'number' || typeof entry.mime !== 'string') {
      throw new Error(`El recurso ${key} tiene un formato inválido`);
    }
    const chunks = entry.chunks.map((candidate, index) => {
      const chunk = assertObject(candidate, `Chunk ${index} de ${key}`);
      if (
        typeof chunk.hash !== 'string' ||
        typeof chunk.name !== 'string' ||
        chunk.hash !== chunk.name ||
        !/^[a-f0-9]{64}$/.test(chunk.name) ||
        !Array.isArray(chunk.offsets) ||
        chunk.offsets.length !== 2 ||
        !chunk.offsets.every(Number.isSafeInteger)
      ) {
        throw new Error(`Chunk ${index} de ${key} tiene un formato inválido`);
      }
      return chunk;
    });
    selected[key] = { chunks, size: entry.size, mime: entry.mime };
  }

  return selected;
}

async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function resolvePackageRoot(packageName) {
  try {
    return dirname(require.resolve(`${packageName}/package.json`));
  } catch (error) {
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    let directory = dirname(require.resolve(packageName));
    while (directory !== dirname(directory)) {
      try {
        const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (packageJson.name === packageName) return directory;
      } catch {
        // Sigue subiendo desde el entrypoint exportado hasta la raíz del paquete.
      }
      directory = dirname(directory);
    }
    throw new Error(`No se pudo resolver la raíz de ${packageName}`);
  }
}

async function validateChunks(resources, directory) {
  const names = new Set();
  for (const entry of Object.values(resources)) {
    let assembledSize = 0;
    for (const chunk of entry.chunks) {
      const expectedSize = chunk.offsets[1] - chunk.offsets[0];
      const chunkPath = join(directory, chunk.name);
      const chunkStat = await stat(chunkPath);
      if (chunkStat.size !== expectedSize) {
        throw new Error(`Tamaño inválido para ${chunk.name}`);
      }
      if ((await sha256(chunkPath)) !== chunk.name) {
        throw new Error(`SHA-256 inválido para ${chunk.name}`);
      }
      assembledSize += expectedSize;
      names.add(chunk.name);
    }
    if (assembledSize !== entry.size) {
      throw new Error('Los tamaños de chunks no coinciden con el recurso ensamblado');
    }
  }
  return names;
}

async function readSourceResources(dataRoot) {
  const sourceDirectory = join(dataRoot, 'dist');
  const raw = JSON.parse(await readFile(join(sourceDirectory, 'resources.json'), 'utf8'));
  return { resources: parseResources(raw), sourceDirectory };
}

async function copyNotices(dataRoot, libraryRoot) {
  const notices = [
    [join(dataRoot, 'LICENSE.md'), 'BACKGROUND_REMOVAL_DATA_LICENSE.md'],
    [join(dataRoot, 'ThirdPartyLicenses.json'), 'BACKGROUND_REMOVAL_DATA_THIRD_PARTY_LICENSES.json'],
    [join(libraryRoot, 'LICENSE.md'), 'BACKGROUND_REMOVAL_LICENSE.md'],
    [join(libraryRoot, 'ThirdPartyLicenses.json'), 'BACKGROUND_REMOVAL_THIRD_PARTY_LICENSES.json'],
  ];
  await Promise.all(notices.map(([source, name]) => copyFile(source, join(outputDirectory, name))));
}

export async function checkPreparedAssets() {
  const manifest = parseResources(
    JSON.parse(await readFile(join(outputDirectory, 'resources.json'), 'utf8')),
  );
  const names = await validateChunks(manifest, outputDirectory);
  const files = await readdir(outputDirectory);
  const allowed = new Set([
    ...names,
    'resources.json',
    'BACKGROUND_REMOVAL_DATA_LICENSE.md',
    'BACKGROUND_REMOVAL_DATA_THIRD_PARTY_LICENSES.json',
    'BACKGROUND_REMOVAL_LICENSE.md',
    'BACKGROUND_REMOVAL_THIRD_PARTY_LICENSES.json',
  ]);
  const missing = [...allowed].filter((name) => !files.includes(name));
  if (missing.length > 0) {
    throw new Error(`Faltan assets generados: ${missing.join(', ')}`);
  }
  const unexpected = files.filter((name) => !allowed.has(name));
  if (unexpected.length > 0) {
    throw new Error(`Archivos inesperados en assets generados: ${unexpected.join(', ')}`);
  }
  return { chunkCount: names.size };
}

export async function prepareAssets() {
  const [dataRoot, libraryRoot] = await Promise.all([
    resolvePackageRoot('@imgly/background-removal-data'),
    resolvePackageRoot('@imgly/background-removal'),
  ]);
  const dataPackage = JSON.parse(await readFile(join(dataRoot, 'package.json'), 'utf8'));
  const libraryPackage = JSON.parse(await readFile(join(libraryRoot, 'package.json'), 'utf8'));
  if (dataPackage.version !== BACKGROUND_REMOVAL_VERSION || libraryPackage.version !== BACKGROUND_REMOVAL_VERSION) {
    throw new Error(`Las dependencias IMG.LY deben estar fijadas en ${BACKGROUND_REMOVAL_VERSION}`);
  }

  const { resources, sourceDirectory } = await readSourceResources(dataRoot);
  const sourceChunks = await validateChunks(resources, sourceDirectory);

  try {
    const current = await checkPreparedAssets();
    if (current.chunkCount === sourceChunks.size) {
      return current;
    }
  } catch {
    // Una instalación incompleta o anterior se regenera por completo.
  }

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    [...sourceChunks].map((name) => copyFile(join(sourceDirectory, name), join(outputDirectory, name))),
  );
  await writeFile(join(outputDirectory, 'resources.json'), `${JSON.stringify(resources, null, 2)}\n`);
  await copyNotices(dataRoot, libraryRoot);
  return checkPreparedAssets();
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const result = process.argv.includes('--check')
    ? await checkPreparedAssets()
    : await prepareAssets();
  console.log(`Assets de eliminación de fondo verificados: ${result.chunkCount} chunks.`);
}
