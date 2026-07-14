import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { doRecheck } from './recheckWorker';
import { QbtClient } from './qbtClient';
import { initDb, getDb } from './db';

describe('RecheckWorker', () => {
  let mockQbt: QbtClient;
  let db: any;

  beforeEach(() => {
    db = initDb(':memory:');
    db.prepare('INSERT INTO torrents (hash, name, save_path) VALUES (?, ?, ?)').run('hash123', 'Torrent', '/tmp');

    mockQbt = {
      recheck: vi.fn(),
      resume: vi.fn(),
      torrentsByHash: vi.fn()
    } as unknown as QbtClient;

    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('polls checking state and resumes when pausedUP', async () => {
    let pollCount = 0;
    vi.mocked(mockQbt.torrentsByHash).mockImplementation(async () => {
      pollCount++;
      if (pollCount === 1) return { hash: 'hash123', state: 'checkingUP' } as any;
      if (pollCount === 2) return { hash: 'hash123', state: 'checkingUP' } as any;
      return { hash: 'hash123', state: 'pausedUP' } as any;
    });

    await doRecheck('hash123', mockQbt, 1, 10);

    expect(mockQbt.recheck).toHaveBeenCalledWith('hash123');
    expect(mockQbt.torrentsByHash).toHaveBeenCalledTimes(3);
    expect(mockQbt.resume).toHaveBeenCalledWith('hash123');

    const torrent = db.prepare('SELECT state FROM torrents WHERE hash = ?').get('hash123') as any;
    expect(torrent.state).toBe('rechecked');

    const event = db.prepare('SELECT * FROM events WHERE torrent_hash = ?').get('hash123') as any;
    expect(event.type).toBe('recheck_complete');
  });

  it('throws error if timeout occurs', async () => {
    vi.mocked(mockQbt.torrentsByHash).mockResolvedValue({ hash: 'hash123', state: 'checkingUP' } as any);

    await expect(doRecheck('hash123', mockQbt, 1, 3)).rejects.toThrow('Recheck timeout for hash123');
  });
});
