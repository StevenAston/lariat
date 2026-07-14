import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processUpgrade } from './upgradeWorker';
import { QbtClient } from './qbtClient';
import { initDb } from './db';
import { ImportEvent } from './webhooks';

describe('UpgradeWorker', () => {
  let mockQbt: QbtClient;
  let db: any;

  beforeEach(() => {
    db = initDb(':memory:');
    db.prepare('INSERT INTO torrents (hash, name, save_path) VALUES (?, ?, ?)').run('oldhash', 'Old Torrent', '/tmp');
    db.prepare('INSERT INTO links (hash, qbt_land_path, plex_land_path, swap_status) VALUES (?, ?, ?, ?)').run('oldhash', '/tmp/old.mkv', '/plex/Show S01E01.mkv', 'swapped');

    mockQbt = {
      pause: vi.fn()
    } as unknown as QbtClient;

    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pauses old torrent if deleted file matches a link in DB', async () => {
    const event: ImportEvent = {
      source: 'sonarr',
      isUpgrade: true,
      hash: 'newhash',
      plexPath: '/plex/Show S01E01.mkv',
      arrRefs: {},
      deletedFiles: ['/plex/Show S01E01.mkv']
    };

    await processUpgrade(event, mockQbt);

    expect(mockQbt.pause).toHaveBeenCalledWith('oldhash');

    const ev = db.prepare('SELECT * FROM events WHERE torrent_hash = ?').get('oldhash') as any;
    expect(ev.type).toBe('upgrade_detected');
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
