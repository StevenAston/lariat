import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleImportEvent } from './orchestrator';
import { QbtClient } from './qbtClient';
import { initDb, getDb } from './db';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Orchestrator', () => {
  let mockQbt: QbtClient;
  let db: any;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-orch-'));
    db = initDb(':memory:');
    db.prepare('INSERT INTO torrents (hash, name, save_path) VALUES (?, ?, ?)').run('hash123', 'Torrent', tempDir);

    mockQbt = {
      torrentsByHash: vi.fn(),
      torrentFiles: vi.fn(),
      pause: vi.fn(),
      recheck: vi.fn(),
      resume: vi.fn(),
    } as unknown as QbtClient;

    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('runs full import flow', async () => {
    const qbtPath = path.join(tempDir, 'file.mkv');
    const plexPath = path.join(tempDir, 'plex.mkv');
    
    fs.writeFileSync(qbtPath, 'qbt content');
    fs.writeFileSync(plexPath, 'qbt content'); // same size for detector

    vi.mocked(mockQbt.torrentsByHash).mockResolvedValue({ hash: 'hash123', state: 'downloading', save_path: tempDir } as any);
    vi.mocked(mockQbt.torrentFiles).mockResolvedValue([{ name: 'plex.mkv', size: 11, progress: 1 }] as any);

    const event = {
      source: 'sonarr',
      isUpgrade: false,
      hash: 'hash123',
      plexPath,
      arrRefs: {},
      deletedFiles: []
    };

    // Need config to be set so loadConfig doesn't throw
    process.env.QBT_URL = 'http://localhost:8080';
    process.env.QBT_USER = 'admin';
    process.env.QBT_PASS = 'adminadmin';
    process.env.ARR_URL = 'http://localhost:8989';
    process.env.ARR_API_KEY = 'apikey';
    process.env.SWAP_MODE = 'copy';

    const promise = handleImportEvent(event as any, mockQbt);
    await vi.runAllTimersAsync();
    await promise;

    // Wait for debounce timeout to see it queued
    // But debounceRecheck only triggers a callback, we can just assert the link was saved and swapped
    const link = db.prepare('SELECT * FROM links WHERE hash = ?').get('hash123') as any;
    expect(link).not.toBeUndefined();
    expect(link.swap_status).toBe('linked');
  });
});
