import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const databaseUrl = 'postgres://app:s3cret-pw@localhost:5433/aangan';
// apps/api/test is three folders below the repo root. Vitest runs with apps/api as the working
// directory, so the cases below also prove the result does not depend on it.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl })).toEqual({
      PORT: 4000,
      LOG_LEVEL: 'info',
      DATABASE_URL: databaseUrl,
      SEED_DIR: resolve(repoRoot, 'roles/full-stack-engineer/seed'),
    });
  });

  // Relative values are joined to the repo root, like the default, so they mean the same folder
  // under npm -w apps/api, at the root and in the image.
  it('resolves a relative SEED_DIR against the repo root, not the working directory', () => {
    const dir = loadConfig({ DATABASE_URL: databaseUrl, SEED_DIR: 'some/seed' }).SEED_DIR;
    expect(dir).toBe(resolve(repoRoot, 'some/seed'));
    expect(dir).not.toBe(resolve(process.cwd(), 'some/seed'));
  });

  it('uses an absolute SEED_DIR as it is', () => {
    const absolute = resolve(tmpdir(), 'seed');
    expect(loadConfig({ DATABASE_URL: databaseUrl, SEED_DIR: absolute }).SEED_DIR).toBe(absolute);
  });

  it('names a missing variable', () => {
    expect(messageOf(() => loadConfig({}))).toContain('DATABASE_URL');
  });

  it('names invalid variables without echoing their values', () => {
    const message = messageOf(() =>
      loadConfig({ PORT: 'not-a-port', DATABASE_URL: 'mysql://app:s3cret-pw@localhost/aangan' }),
    );

    expect(message).toContain('PORT');
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('not-a-port');
    expect(message).not.toContain('s3cret-pw');
  });
});
