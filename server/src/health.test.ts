import { describe, it, expect, beforeEach, afterEach, vi, MockInstance } from 'vitest';
import request from 'supertest';
import app from './index';
import * as db from './db';
import * as qbtClient from './qbtClient';
import * as arrClient from './arrClient';
import fs from 'fs';
import { log, addLogListener } from './logger';

describe('HealthCheck', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/health/system returns health object and handles symlink failure', async () => {
    // Mock DB
    const mockDb = { prepare: vi.fn().mockReturnValue({ get: vi.fn() }) } as any;
    vi.spyOn(db, 'getDb').mockReturnValue(mockDb);

    // Mock QBT
    vi.spyOn(qbtClient.QbtClient.prototype, 'torrentsInfo').mockResolvedValue([]);

    // Mock Arr
    vi.spyOn(arrClient.SonarrClient.prototype, 'getSeries').mockResolvedValue({ id: 1 } as any);
    vi.spyOn(arrClient.RadarrClient.prototype, 'getMovie').mockResolvedValue({ id: 1 } as any);

    // Mock symlink failure
    vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      throw new Error('Symlink privilege not held');
    });
    
    // We also want to capture the critical log
    const logSpy = vi.fn();
    addLogListener(logSpy);

    const res = await request(app).get('/api/health/system');
    
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      db: true,
      qbt: true,
      sonarr: true,
      radarr: true,
      symlink_privilege: false
    });

    // Verify critical event was logged
    expect(logSpy).toHaveBeenCalledWith('critical', 'HealthCheck', 'Symlink privilege check failed', { error: 'Symlink privilege not held' });
  });
});
