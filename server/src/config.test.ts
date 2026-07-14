import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalisePath } from './config';

describe('Config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('normalisePath should normalize Windows paths correctly', () => {
    expect(normalisePath('X:\\Foo\\Bar.mkv') === normalisePath('x:/foo/bar.mkv')).toBe(true);
    expect(normalisePath(' D:\\Test\\file.mkv ')).toBe('d:/test/file.mkv');
  });

  it('loadConfig should throw if required env vars are missing', async () => {
    vi.stubEnv('QBT_HOST', '');
    vi.stubEnv('QBT_USER', '');
    
    // dynamically import to trigger the zod validation with missing env
    await expect(import('./config')).rejects.toThrow(/Configuration missing or invalid: env.QBT_HOST/);
  });
});
