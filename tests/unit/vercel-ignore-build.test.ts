import { describe, expect, it, vi } from 'vitest';
// The ignore step must also work without installed dependencies.
import { canSkipBuild, ignoredBuildExitCode, isNonApplicationPath } from '../../scripts/vercel-ignore-build.mjs';

const previous = 'a'.repeat(40);
const current = 'b'.repeat(40);

describe('control conservador de builds Vercel', () => {
  it('solo omite documentación y el respaldo independiente de la web', () => {
    expect(canSkipBuild(previous, current, ['docs/BACKUPS.md', 'scripts/backups/policy.mts',
      '.github/workflows/database-backup.yml', 'tests/unit/backup-drive.test.ts', 'AGENTS.md'])).toBe(true);
    expect(canSkipBuild(previous, current, [])).toBe(true);
  });

  it.each(['src/app/page.tsx', 'public/vendor/background-removal/model', 'package.json',
    'pnpm-lock.yaml', 'tsconfig.json', 'next.config.ts', 'vercel.json', 'content/privacy.md',
    'scripts/vercel-ignore-build.mjs', '.gitignore', '.github/workflows/ci.yml'])('construye al cambiar %s', (file) => {
    expect(isNonApplicationPath(file)).toBe(false);
    expect(canSkipBuild(previous, current, ['docs/BACKUPS.md', file])).toBe(false);
  });

  it('no compara únicamente con HEAD^: incluye todos los cambios desde el último deployment', () => {
    const git = vi.fn().mockReturnValueOnce('').mockReturnValueOnce('')
      .mockReturnValueOnce('src/app/page.tsx\0docs/BACKUPS.md\0');
    expect(ignoredBuildExitCode({ VERCEL_GIT_PREVIOUS_SHA: previous, VERCEL_GIT_COMMIT_SHA: current }, git)).toBe(1);
    expect(git).toHaveBeenLastCalledWith('git', ['diff', '--name-only', '--no-renames', '-z', previous, current],
      expect.any(Object));
  });

  it('devuelve cero para un diff verificado exclusivamente no aplicativo', () => {
    const git = vi.fn().mockReturnValueOnce('').mockReturnValueOnce('').mockReturnValueOnce('docs/SYNC.md\0');
    expect(ignoredBuildExitCode({ VERCEL_GIT_PREVIOUS_SHA: previous, VERCEL_GIT_COMMIT_SHA: current }, git)).toBe(0);
  });

  it('construye en el primer deployment, SHAs inválidos y git fallido sin imprimir errores', () => {
    expect(ignoredBuildExitCode({})).toBe(1);
    expect(ignoredBuildExitCode({ VERCEL_GIT_PREVIOUS_SHA: 'HEAD^', VERCEL_GIT_COMMIT_SHA: current })).toBe(1);
    const git = vi.fn(() => { throw new Error('missing history'); });
    expect(ignoredBuildExitCode({ VERCEL_GIT_PREVIOUS_SHA: previous, VERCEL_GIT_COMMIT_SHA: current }, git)).toBe(1);
  });
});
