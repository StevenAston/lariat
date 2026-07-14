import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { apiRouter } from './api';
import { initDb, getDb } from './db';
import * as recheckWorker from './recheckWorker';

const app = express();
app.use('/api', apiRouter);

describe('API Router', () => {
  let db: any;

  beforeEach(() => {
    db = initDb(':memory:');
    
    // Add some dummy data
    db.prepare('INSERT INTO torrents (hash, name, save_path) VALUES (?, ?, ?)').run('hash1', 'Test', '/path');
    db.prepare(`
      INSERT INTO links (hash, file_name, file_size, qbt_land_path, plex_land_path, swap_status, swap_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('hash1', 'file.mkv', 100, '/path/file.mkv', '/plex/file.mkv', 'linked', 'copy');
    db.prepare('INSERT INTO events (torrent_hash, type, message) VALUES (?, ?, ?)').run('hash1', 'test', 'A test event');

    process.env.QBT_HOST = 'localhost';
    process.env.QBT_PORT = '8080';
    process.env.QBT_USER = 'admin';
    process.env.QBT_PASS = 'adminadmin';

    vi.spyOn(recheckWorker, 'doRecheck').mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/status returns summary statistics', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.torrents).toBe(1);
    expect(res.body.data.links).toBe(1);
    expect(res.body.data.recentEvents.length).toBe(1);
    expect(res.body.data.recentEvents[0].message).toBe('A test event');
  });

  it('POST /api/recheck/:hash triggers manual recheck', async () => {
    const res = await request(app).post('/api/recheck/hash1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Recheck started');
    
    expect(recheckWorker.doRecheck).toHaveBeenCalledWith('hash1', expect.anything());
  });

  it('POST /api/recheck/:hash returns 404 for unknown hash', async () => {
    const res = await request(app).post('/api/recheck/unknown');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Torrent not found');
  });

  it('GET /api/topology returns nodes and connections', async () => {
    // Update link health to 'healthy' to test lens
    db.prepare(`UPDATE links SET current_health = 'healthy' WHERE hash = 'hash1'`).run();
    
    // Default lens is 'broken' so it shouldn't return this healthy link
    let res = await request(app).get('/api/topology');
    expect(res.status).toBe(200);
    expect(res.body.data.nodes.length).toBe(0);

    // Query with lens=healthy
    res = await request(app).get('/api/topology?lens=healthy');
    expect(res.status).toBe(200);
    expect(res.body.data.nodes.length).toBe(4); // 4 nodes for 1 link
    expect(res.body.data.connections.length).toBe(3); // 3 connections
    
    // Check connections are marked 'linked' since it's healthy
    const conn = res.body.data.connections;
    expect(conn[0].status).toBe('linked');
    expect(conn[1].status).toBe('linked');
    expect(conn[2].status).toBe('linked');
  });
});

