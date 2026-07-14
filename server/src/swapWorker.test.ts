import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { doSwap } from './swapWorker';
import { initDb, getDb } from './db';

describe('SwapWorker', () => {
  let tempDir: string;
  let db: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-test-'));
    db = initDb(':memory:');
    db.prepare('INSERT INTO torrents (hash, name, save_path) VALUES (?, ?, ?)').run('hash123', 'Torrent', '/tmp/qbt');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('copy mode overwrites Plex file with QBT file and updates DB', async () => {
    const qbtPath = path.join(tempDir, 'qbt.mkv');
    const plexPath = path.join(tempDir, 'plex.mkv');

    fs.writeFileSync(qbtPath, 'qbt content');
    fs.writeFileSync(plexPath, 'plex content');

    const insert = db.prepare(`
      INSERT INTO links (hash, qbt_land_path, plex_land_path, swap_status) 
      VALUES (?, ?, ?, ?)
    `);
    const info = insert.run('hash123', qbtPath, plexPath, 'pending');
    const linkId = info.lastInsertRowid;

    await doSwap(linkId, 'copy');

    // File should be overwritten
    const content = fs.readFileSync(plexPath, 'utf8');
    expect(content).toBe('qbt content');

    // DB should be updated
    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId) as any;
    expect(link.swap_status).toBe('swapped');

    const event = db.prepare('SELECT * FROM events WHERE link_id = ?').get(linkId) as any;
    expect(event.type).toBe('swap');
    expect(event.message).toContain('copy');
  });

  it('move mode overwrites Plex file, removes QBT file and updates DB', async () => {
    const qbtPath = path.join(tempDir, 'qbt2.mkv');
    const plexPath = path.join(tempDir, 'plex2.mkv');

    fs.writeFileSync(qbtPath, 'qbt content move');
    fs.writeFileSync(plexPath, 'plex content move');

    const insert = db.prepare(`
      INSERT INTO links (hash, qbt_land_path, plex_land_path, swap_status) 
      VALUES (?, ?, ?, ?)
    `);
    const info = insert.run('hash123', qbtPath, plexPath, 'pending');
    const linkId = info.lastInsertRowid;

    await doSwap(linkId, 'move');

    // Plex File should be overwritten
    const content = fs.readFileSync(plexPath, 'utf8');
    expect(content).toBe('qbt content move');

    // QBT File should be deleted
    expect(fs.existsSync(qbtPath)).toBe(false);

    // DB should be updated
    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId) as any;
    expect(link.swap_status).toBe('swapped');

    const event = db.prepare('SELECT * FROM events WHERE link_id = ?').get(linkId) as any;
    expect(event.type).toBe('swap');
    expect(event.message).toContain('move');
  });
});
