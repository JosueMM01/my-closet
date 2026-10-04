import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/database-backup.yml', import.meta.url), 'utf8');

describe('contrato del workflow de recuperación', () => {
  it('usa herramientas 18 y comprueba compatibilidad antes del dump', () => {
    expect(workflow).toContain('POSTGRES_IMAGE: postgres:18-alpine');
    expect(workflow.indexOf('validate-tool-version')).toBeLessThan(workflow.indexOf('pg_dump --dbname='));
  });

  it('respeta el timeout predeterminado de Neon Free', () => {
    expect(workflow).toMatch(/suspend_timeout: 0\s/);
  });

  it('valida el aislamiento antes de cualquier DROP y solo borra una rama nueva', () => {
    expect(workflow.indexOf('validate-restore')).toBeLessThan(workflow.indexOf('DROP SCHEMA'));
    expect(workflow).toContain("steps.restore-branch.outputs.created == 'true'");
  });

  it('inicializa rutas usando RUNNER_TEMP durante un step', () => {
    expect(workflow).toContain('BACKUP_DUMP_PATH=$RUNNER_TEMP/');
    expect(workflow).not.toMatch(/BACKUP_[A-Z_]+:\s*\$\{\{\s*runner\.temp/);
  });
});
