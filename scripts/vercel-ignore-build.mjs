import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Runs before dependency installation: keep this script dependency-free.
export function isNonApplicationPath(file) {
  return ['README.md', 'AGENTS.md', '.github/workflows/database-backup.yml',
    'tests/unit/backup-policy.test.ts', 'tests/unit/backup-drive.test.ts'].includes(file)
    || file.startsWith('docs/') || file.startsWith('scripts/backups/');
}

export function canSkipBuild(previousSha, currentSha, files) {
  const sha = /^[a-f0-9]{40}$/i;
  return sha.test(previousSha ?? '') && sha.test(currentSha ?? '')
    && files.every(isNonApplicationPath);
}

/** @param {{VERCEL_GIT_PREVIOUS_SHA?: string, VERCEL_GIT_COMMIT_SHA?: string}} env */
export function ignoredBuildExitCode(env = process.env, git = execFileSync) {
  const previous = env.VERCEL_GIT_PREVIOUS_SHA;
  const current = env.VERCEL_GIT_COMMIT_SHA;
  if (!/^[a-f0-9]{40}$/i.test(previous ?? '') || !/^[a-f0-9]{40}$/i.test(current ?? '')) return 1;
  try {
    const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
    // A shallow clone, missing history or unrelated base must trigger a build.
    git('git', ['cat-file', '-e', `${previous}^{commit}`], options);
    git('git', ['merge-base', '--is-ancestor', previous, current], options);
    const files = git('git', ['diff', '--name-only', '--no-renames', '-z', previous, current], options)
      .split('\0').filter(Boolean);
    return canSkipBuild(previous, current, files) ? 0 : 1;
  } catch {
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = ignoredBuildExitCode();
  console.log(code === 0
    ? 'Sin cambios de aplicación desde el último deployment: omitir build.'
    : 'Cambios relevantes o historial no verificable: realizar build.');
  process.exitCode = code; // Vercel: 0 skips; 1 builds. This is intentional.
}
