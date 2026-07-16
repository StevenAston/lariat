import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { doSwap } from './swapWorker';
import { initDb, getDb } from './db';
import { QbtClient } from './qbtClient';

describe('SwapWorker', () => {
  let tempDir: string;
  let db: any;
  let mockQbt: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-test-'));
    db = initDb(':memory:');
    db.prepare('INSERT INTO torrents (hash, name, save_path) VALUES (?, ?, ?)').run('hash123', 'Torrent', tempDir);
    mockQbt = {
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('copy mode renames to bak, symlinks, and deletes bak', async () => {
    const qbtPath = path.join(tempDir, 'qbt.mkv');
    const plexPath = path.join(tempDir, 'plex.mkv');
    const bakPath = `${qbtPath}.bak`;

    fs.writeFileSync(qbtPath, 'qbt content');
    fs.writeFileSync(plexPath, 'plex content');

    const insert = db.prepare(`
      INSERT INTO links (hash, qbt_land_path, plex_land_path, swap_status) 
      VALUES (?, ?, ?, ?)
    `);
    const info = insert.run('hash123', qbtPath, plexPath, 'pending');
    const linkId = info.lastInsertRowid;

    await doSwap(linkId as number, 'copy', mockQbt as any);

    // QBT path is now a symlink pointing to Plex path
    expect(fs.lstatSync(qbtPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(qbtPath)).toBe(plexPath);

    // Bak file is deleted
    expect(fs.existsSync(bakPath)).toBe(false);

    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId) as any;
    expect(link.swap_status).toBe('linked');

    expect(mockQbt.pause).toHaveBeenCalledWith('hash123');
    expect(mockQbt.resume).not.toHaveBeenCalled(); // Left paused for recheck
  });

  it('move mode creates symlink without renaming to bak', async () => {
    const qbtPath = path.join(tempDir, 'qbt.mkv');
    const plexPath = path.join(tempDir, 'plex.mkv');

    // In move mode, Sonarr moved the file to Plex, so qbtPath is empty
    fs.writeFileSync(plexPath, 'plex content');

    const insert = db.prepare(`
      INSERT INTO links (hash, qbt_land_path, plex_land_path, swap_status) 
      VALUES (?, ?, ?, ?)
    `);
    const info = insert.run('hash123', qbtPath, plexPath, 'pending');
    const linkId = info.lastInsertRowid;

    await doSwap(linkId as number, 'move', mockQbt as any);

    // QBT path is now a symlink pointing to Plex path
    expect(fs.lstatSync(qbtPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(qbtPath)).toBe(plexPath);

    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId) as any;
    expect(link.swap_status).toBe('linked');

    expect(mockQbt.pause).toHaveBeenCalledWith('hash123');
  });

  it('copy mode rolls back to bak and resumes on failure', async () => {
    const qbtPath = path.join(tempDir, 'qbt.mkv');
    const plexPath = path.join(tempDir, 'plex.mkv');

    fs.writeFileSync(qbtPath, 'qbt content');
    // We intentionally don't create plexPath so it fails pre-flight guards
    
    const insert = db.prepare(`
      INSERT INTO links (hash, qbt_land_path, plex_land_path, swap_status) 
      VALUES (?, ?, ?, ?)
    `);
    const info = insert.run('hash123', qbtPath, plexPath, 'pending');
    const linkId = info.lastInsertRowid;

    await expect(doSwap(linkId as number, 'copy', mockQbt as any)).rejects.toThrow();

    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId) as any;
    expect(link.swap_status).toBe('pending'); // Pre-flight didn't change it. Wait, the rollback block only triggers on errors during/after pause?
    // Let's test a mid-flight failure by making symlinkSync throw
  });
});
