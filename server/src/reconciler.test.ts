import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runReconciliation } from './reconciler';
import { getDb, initDb } from './db';
import { QbtClient } from './qbtClient';
import { SonarrClient, RadarrClient } from './arrClient';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('Reconciliation Worker', () => {
  let mockQbt: Partial<QbtClient>;
  let mockSonarr: Partial<SonarrClient>;
  let mockRadarr: Partial<RadarrClient>;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lariat-recon-'));
    initDb(':memory:');

    const healthyQbt = path.join(tempDir, 'healthy_qbt.mkv');
    const healthyPlex = path.join(tempDir, 'healthy_plex.mkv');
    await fs.writeFile(healthyPlex, 'content');
    await fs.symlink(healthyPlex, healthyQbt, 'file');

    const orphanQbt = path.join(tempDir, 'orphan_qbt.mkv');
    const orphanPlex = path.join(tempDir, 'orphan_plex.mkv');
    // Don't create orphanPlex!
    await fs.symlink(orphanPlex, orphanQbt, 'file');

    const unprocessedQbt = path.join(tempDir, 'unprocessed_qbt.mkv');
    const unprocessedPlex = path.join(tempDir, 'unprocessed_plex.mkv');
    await fs.writeFile(unprocessedQbt, 'content');
    // No symlink on disk

    const db = getDb();
    db.prepare(`
      INSERT INTO torrents (hash, name, save_path, state) 
      VALUES (?, ?, ?, 'downloading')
    `).run('h_unprocessed', 'unprocessed', tempDir);
    db.prepare(`
      INSERT INTO links (hash, qbt_land_path, plex_land_path, swap_status) 
      VALUES (?, ?, ?, 'pending')
    `).run('h_unprocessed', unprocessedQbt, unprocessedPlex);

    const missingPlex = path.join(tempDir, 'missing_plex.mkv');
    // Neither QBT nor Plex file exists

    const unmanagedQbt = path.join(tempDir, 'unmanaged_qbt.mkv');
    await fs.writeFile(unmanagedQbt, 'content');

    mockQbt = {
      torrentsInfo: vi.fn().mockResolvedValue([
        { hash: 'h_healthy', save_path: tempDir, name: 'healthy' },
        { hash: 'h_orphan', save_path: tempDir, name: 'orphan' },
        { hash: 'h_unprocessed', save_path: tempDir, name: 'unprocessed' },
        { hash: 'h_unmanaged', save_path: tempDir, name: 'unmanaged' },
      ]),
      torrentFiles: vi.fn().mockImplementation(async (hash: string) => {
        if (hash === 'h_healthy') return [{ name: 'healthy_qbt.mkv', size: 100 }];
        if (hash === 'h_orphan') return [{ name: 'orphan_qbt.mkv', size: 100 }];
        if (hash === 'h_unprocessed') return [{ name: 'unprocessed_qbt.mkv', size: 100 }];
        if (hash === 'h_unmanaged') return [{ name: 'unmanaged_qbt.mkv', size: 100 }];
        return [];
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      recheck: vi.fn(),
    };

    mockSonarr = {
      listEpisodeFiles: vi.fn().mockResolvedValue([
        { id: 1, seriesId: 1, seasonNumber: 1, path: healthyPlex, size: 100 },
        { id: 2, seriesId: 1, seasonNumber: 1, path: orphanPlex, size: 100 },
        { id: 3, seriesId: 1, seasonNumber: 1, path: unprocessedPlex, size: 100 },
        { id: 4, seriesId: 1, seasonNumber: 1, path: missingPlex, size: 100 }
      ])
    };

    mockRadarr = {
      listMovieFiles: vi.fn().mockResolvedValue([])
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('correctly classifies a mixed seed and does not mutate', async () => {
    const summary = await runReconciliation(
      mockQbt as QbtClient,
      mockSonarr as SonarrClient,
      mockRadarr as RadarrClient
    );

    expect(summary.healthy).toBe(1);
    expect(summary.orphan_symlink).toBe(1);
    expect(summary.unprocessed).toBe(1);
    expect(summary.missing_real_file).toBe(1); // Wait, if missing_plex isn't in QBT, is it missing_real_file? Yes.
    expect(summary.unmanaged_torrent).toBe(1);

    const db = getDb();
    const links = db.prepare('SELECT current_health, hash FROM links').all() as any[];
    
    const findHealth = (hash: string | null) => links.find(l => l.hash === hash)?.current_health;
    const findHealthByHashNull = () => links.find(l => l.hash === null)?.current_health; // missing_plex has no hash

    expect(findHealth('h_healthy')).toBe('healthy');
    expect(findHealth('h_orphan')).toBe('orphan_symlink');
    expect(findHealth('h_unprocessed')).toBe('unprocessed');
    expect(findHealth('h_unmanaged')).toBe('unmanaged_torrent');
    expect(findHealthByHashNull()).toBe('missing_real_file'); // arr only, no qbt file

    const events = db.prepare('SELECT * FROM events WHERE type = ?').all('reconciliation') as any[];
    expect(events.length).toBe(1);
    expect(JSON.parse(events[0].detail).healthy).toBe(1);

    // No mutations
    expect(mockQbt.pause).not.toHaveBeenCalled();
    expect(mockQbt.resume).not.toHaveBeenCalled();
    expect(mockQbt.recheck).not.toHaveBeenCalled();
  });
});
