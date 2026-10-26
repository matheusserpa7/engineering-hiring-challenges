import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const databaseUrl = 'postgres://app:s3cret-pw@localhost:5433/aangan';

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
    });
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
