import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthWorker } from './healthWorker';
import { getDb, initDb } from './db';
import { QbtClient } from './qbtClient';
import { Anomaly } from './classifier';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('Health Worker', () => {
  let mockQbt: Partial<QbtClient>;
  let tempDir: string;
  let qbtPath: string;
  let plexPath: string;
  let worker: HealthWorker;
  let db: any;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lariat-health-'));
    qbtPath = path.join(tempDir, 'qbt.mkv');
    plexPath = path.join(tempDir, 'plex.mkv');

    initDb(':memory:');
    db = getDb();

    // Create torrent and link
    db.prepare(`
      INSERT INTO torrents (hash, name, save_path, state) 
      VALUES (?, ?, ?, 'downloading')
    `).run('hash123', 'test', tempDir);

    db.prepare(`
      INSERT INTO links (hash, qbt_land_path, plex_land_path, current_health) 
      VALUES (?, ?, ?, ?)
    `).run('hash123', qbtPath, plexPath, Anomaly.Healthy);

    mockQbt = {
      torrentsByHash: vi.fn().mockResolvedValue({ hash: 'hash123' })
    };

    worker = new HealthWorker(mockQbt as QbtClient);
  });

  afterEach(async () => {
    worker.stopSchedule();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reports healthy when files are correct', async () => {
    // Setup healthy state
    await fs.writeFile(plexPath, 'content');
    await fs.symlink(plexPath, qbtPath, 'file');

    const result = await worker.checkLinkHealthById(1);
    expect(result.anomaly).toBe(Anomaly.Healthy);

    const checks = db.prepare('SELECT * FROM health_checks').all() as any[];
    expect(checks.length).toBe(1);
    expect(checks[0].status).toBe(Anomaly.Healthy);
    
    const detail = JSON.parse(checks[0].detail);
    expect(detail.qbtPathExists).toBe(true);
    expect(detail.qbtPathIsSymlink).toBe(true);
    expect(detail.plexPathExists).toBe(true);
    expect(detail.plexPathIsSymlink).toBe(false);
    expect(detail.qbtPresence).toBe(true);
  });

  it('flips to orphan_symlink on break and emits one transition event', async () => {
    // Setup healthy state
    await fs.writeFile(plexPath, 'content');
    await fs.symlink(plexPath, qbtPath, 'file');

    await worker.checkLinkHealthById(1);

    // Break the symlink by removing the target
    await fs.unlink(plexPath);

    const result2 = await worker.checkLinkHealthById(1);
    expect(result2.anomaly).toBe(Anomaly.OrphanSymlink);
    
    // Check events
    const events = db.prepare('SELECT * FROM events WHERE type = ?').all('degradation') as any[];
    expect(events.length).toBe(1);
    const detail = JSON.parse(events[0].detail);
    expect(detail.from).toBe(Anomaly.Healthy);
    expect(detail.to).toBe(Anomaly.OrphanSymlink);
  });

  it('scheduled sweep visits every link', async () => {
    // Create another link
    db.prepare(`
      INSERT INTO torrents (hash, name, save_path, state) 
      VALUES (?, ?, ?, 'downloading')
    `).run('hash456', 'test2', tempDir);

    db.prepare(`
      INSERT INTO links (hash, qbt_land_path, plex_land_path, current_health) 
      VALUES (?, ?, ?, ?)
    `).run('hash456', qbtPath, plexPath, Anomaly.Healthy);

    const spy = vi.spyOn(worker as any, 'checkLinkHealth');
    
    await worker.runSweep();

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
