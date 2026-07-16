import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processUpgrade } from './upgradeWorker';
import { QbtClient } from './qbtClient';
import { initDb } from './db';
import { ImportEvent } from './webhooks';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('UpgradeWorker', () => {
  let mockQbt: QbtClient;
  let db: any;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-upgrade-'));
    db = initDb(':memory:');
    db.prepare('INSERT INTO torrents (hash, name, save_path) VALUES (?, ?, ?)').run('oldhash', 'Old Torrent', tempDir);
    
    const oldQbtPath = path.join(tempDir, 'old.mkv');
    fs.writeFileSync(oldQbtPath, 'old content'); // Mock the symlink with a real file

    db.prepare('INSERT INTO links (hash, file_name, qbt_land_path, plex_land_path, swap_status) VALUES (?, ?, ?, ?, ?)').run('oldhash', 'old.mkv', oldQbtPath, '/plex/Show S01E01.mkv', 'linked');

    mockQbt = {
      pause: vi.fn(),
      torrentFiles: vi.fn().mockResolvedValue([{ index: 0, name: 'old.mkv', size: 100, progress: 1 }]),
      filePrio: vi.fn()
    } as unknown as QbtClient;

    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('pauses old torrent, sets prio to 0, deletes symlink, and queues recheck if deleted file matches DB', async () => {
    const event: ImportEvent = {
      source: 'sonarr',
      isUpgrade: true,
      hash: 'newhash',
      plexPath: '/plex/Show S01E01.mkv',
      arrRefs: {},
      deletedFiles: ['/plex/Show S01E01.mkv']
    };

    await processUpgrade(event, mockQbt);

    // QBT interactions
    expect(mockQbt.pause).toHaveBeenCalledWith('oldhash');
    expect(mockQbt.filePrio).toHaveBeenCalledWith('oldhash', 0, 0);

    // Symlink deleted
    const oldQbtPath = path.join(tempDir, 'old.mkv');
    expect(fs.existsSync(oldQbtPath)).toBe(false);

    // Event emitted
    const ev = db.prepare('SELECT * FROM events WHERE torrent_hash = ?').get('oldhash') as any;
    expect(ev.type).toBe('upgrade_detected');

    // Link updated to upgraded
    const link = db.prepare('SELECT swap_status FROM links WHERE hash = ?').get('oldhash') as any;
    expect(link.swap_status).toBe('upgraded');
  });

  it('does nothing if not an upgrade', async () => {
    const event: ImportEvent = {
      source: 'sonarr',
      isUpgrade: false,
      hash: 'newhash',
      plexPath: '/plex/Show S01E01.mkv',
      arrRefs: {},
      deletedFiles: []
    };

    await processUpgrade(event, mockQbt);

    expect(mockQbt.pause).not.toHaveBeenCalled();
  });
});
