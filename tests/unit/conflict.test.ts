import { describe, expect, it } from 'vitest';
import { nextWrite, resolveConflict, shouldApplyRemote } from '@/lib/domain/conflict';

const base = {
  id: 'aaa',
  version: 3,
  updatedAt: '2026-01-02T10:00:00.000Z',
  deletedAt: null,
};

describe('resolveConflict', () => {
  it('gana la versión mayor', () => {
    const local = { ...base, version: 3 };
    const remote = { ...base, id: 'bbb', version: 4 };
    expect(resolveConflict(local, remote)).toBe('remote');
    expect(resolveConflict({ ...local, version: 5 }, remote)).toBe('local');
  });

  it('empate de versión: gana updatedAt mayor', () => {
    const local = { ...base, updatedAt: '2026-01-02T12:00:00.000Z' };
    const remote = { ...base, id: 'bbb', updatedAt: '2026-01-02T11:00:00.000Z' };
    expect(resolveConflict(local, remote)).toBe('local');
  });

  it('empate total: desempate determinista por id', () => {
    const local = { ...base, id: 'aaa' };
    const remote = { ...base, id: 'bbb' };
    expect(resolveConflict(local, remote)).toBe('remote');
    // Simétrico y estable: mismo resultado en el otro dispositivo.
    expect(resolveConflict(remote, local)).toBe('local');
  });

  it('un tombstone más reciente gana como cualquier escritura', () => {
    const local = { ...base, version: 4, updatedAt: '2026-01-03T10:00:00.000Z' };
    const remote = {
      ...base,
      id: 'bbb',
      version: 5,
      updatedAt: '2026-01-04T10:00:00.000Z',
      deletedAt: '2026-01-04T10:00:00.000Z',
    };
    expect(resolveConflict(local, remote)).toBe('remote');
  });
});

describe('shouldApplyRemote', () => {
  it('aplica cuando no hay copia local', () => {
    expect(shouldApplyRemote(undefined, base)).toBe(true);
  });

  it('no aplica si la local es más nueva', () => {
    const local = { ...base, version: 9 };
    const remote = { ...base, id: 'bbb', version: 2 };
    expect(shouldApplyRemote(local, remote)).toBe(false);
  });
});

describe('nextWrite', () => {
  it('incrementa versión y refresca updatedAt', () => {
    const before = { version: 7, updatedAt: '2026-01-01T00:00:00.000Z' };
    const result = nextWrite(before);
    expect(result.version).toBe(8);
    expect(Date.parse(result.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
  });
});
