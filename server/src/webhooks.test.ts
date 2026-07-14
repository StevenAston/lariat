import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { webhookRouter, onImportEvent, ImportEvent } from './webhooks';
import { addLogListener } from './logger';
import fs from 'fs';
import path from 'path';

const app = express();
app.use('/webhook', webhookRouter);

describe('Webhooks', () => {
  beforeEach(() => {
    process.env.QBT_HOST = 'localhost';
    process.env.QBT_PORT = '8080';
    process.env.QBT_USER = 'admin';
    process.env.QBT_PASS = 'adminadmin';
    process.env.SONARR_URL = 'http://localhost:8989';
    process.env.SONARR_API_KEY = 'apikey';
    process.env.RADARR_URL = 'http://localhost:7878';
    process.env.RADARR_API_KEY = 'apikey';
    process.env.SWAP_MODE = 'copy';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Given Sonarr import fixture, produces ImportEvent with isUpgrade=false', async () => {
    const payload = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sonarr-import.json'), 'utf8'));
    
    let capturedEvent: ImportEvent | null = null;
    onImportEvent((event) => {
      capturedEvent = event;
    });

    const res = await request(app)
      .post('/webhook/sonarr')
      .send(payload);

    expect(res.status).toBe(200);
    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent!).toEqual({
      source: 'sonarr',
      isUpgrade: false,
      hash: 'deadbeef1234',
      plexPath: 'C:\\Plex\\TV\\Test Show\\Season 1\\Test Show - S01E01 - Pilot.mkv',
      arrRefs: {
        series_id: 1,
        season_number: 1,
        episode_file_id: 456
      },
      deletedFiles: []
    });
  });

  it('Given Sonarr upgrade fixture, yields isUpgrade=true', async () => {
    const payload = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sonarr-upgrade.json'), 'utf8'));
    
    let capturedEvent: ImportEvent | null = null;
    onImportEvent((event) => {
      capturedEvent = event;
    });

    const res = await request(app)
      .post('/webhook/sonarr')
      .send(payload);

    expect(res.status).toBe(200);
    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent!.isUpgrade).toBe(true);
    expect(capturedEvent!.hash).toBe('deadbeef5678');
  });

  it('A Test payload returns 200 and creates info event without dispatching ImportEvent', async () => {
    const payload = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sonarr-test.json'), 'utf8'));
    
    let dispatched = false;
    onImportEvent(() => {
      dispatched = true;
    });

    const logSpy = vi.fn();
    addLogListener(logSpy);

    const res = await request(app)
      .post('/webhook/sonarr')
      .send(payload);

    expect(res.status).toBe(200);
    expect(dispatched).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('info', 'Webhook', 'Received Sonarr Test event', undefined);
  });
});
