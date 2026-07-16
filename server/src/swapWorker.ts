import fs from 'fs';
import path from 'path';
import { getDb } from './db';
import { log } from './logger';
import { QbtClient } from './qbtClient';

export async function doSwap(linkId: number, mode: 'copy' | 'move', qbtClient: QbtClient): Promise<void> {
  const db = getDb();
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId) as any;

  if (!link) {
    throw new Error(`Link not found: ${linkId}`);
  }

  const qbtPath = link.qbt_land_path;
  const plexPath = link.plex_land_path;
  const hash = link.hash;
  const bakPath = `${qbtPath}.bak`;

  // Pre-flight guards
  if (!fs.existsSync(plexPath)) {
    throw new Error(`Plex file missing: ${plexPath}`);
  }

  const plexStat = fs.lstatSync(plexPath);
  if (!plexStat.isFile()) {
    throw new Error(`Plex file is not a regular file: ${plexPath}`);
  }

  if (fs.existsSync(qbtPath)) {
    const qbtStat = fs.lstatSync(qbtPath);
    if (qbtStat.isSymbolicLink()) {
      const target = fs.readlinkSync(qbtPath);
      if (target === plexPath) {
        log.info('SwapWorker', `Symlink already correct: ${qbtPath} -> ${plexPath}`);
        db.prepare('UPDATE links SET swap_status = ?, updated_at = unixepoch() WHERE id = ?').run('linked', linkId);
        return;
      } else {
        throw new Error(`WRONG_TARGET: ${qbtPath} points to ${target}, expected ${plexPath}`);
      }
    }
  }

  // Pause torrent
  log.info('SwapWorker', `Pausing torrent ${hash} before swap`);
  await qbtClient.pause(hash);
  // Wait a small settle time
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    if (mode === 'copy') {
      if (!fs.existsSync(qbtPath)) {
        throw new Error(`QBT file missing in copy mode: ${qbtPath}`);
      }
      fs.renameSync(qbtPath, bakPath);
      fs.symlinkSync(plexPath, qbtPath, 'file');
      
      const newStat = fs.lstatSync(qbtPath);
      if (!newStat.isSymbolicLink() || fs.readlinkSync(qbtPath) !== plexPath) {
        throw new Error('Symlink verification failed');
      }
      fs.rmSync(bakPath);
      
    } else if (mode === 'move') {
      // In move mode, Sonarr already moved the file to Plex, so qbtPath should be absent
      if (fs.existsSync(qbtPath)) {
         throw new Error(`QBT file still exists in move mode: ${qbtPath}`);
      }
      fs.symlinkSync(plexPath, qbtPath, 'file');
      
      const newStat = fs.lstatSync(qbtPath);
      if (!newStat.isSymbolicLink() || fs.readlinkSync(qbtPath) !== plexPath) {
        throw new Error('Symlink verification failed');
      }
    } else {
      throw new Error(`Unknown mode: ${mode}`);
    }

    db.prepare('UPDATE links SET swap_status = ?, updated_at = unixepoch() WHERE id = ?').run('linked', linkId);

    const insertEvent = db.prepare(`
      INSERT INTO events (link_id, torrent_hash, type, message, detail)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertEvent.run(
      linkId,
      hash,
      'swap',
      `Successfully swapped file using mode: ${mode}`,
      JSON.stringify({ mode, qbtPath, plexPath })
    );

  } catch (err: any) {
    log.error('SwapWorker', `Swap failed, rolling back. Error: ${err.message}`);
    
    // Rollback
    if (mode === 'copy') {
      if (fs.existsSync(qbtPath)) {
        try { fs.rmSync(qbtPath); } catch(e) {}
      }
      if (fs.existsSync(bakPath)) {
        fs.renameSync(bakPath, qbtPath);
      }
      db.prepare('UPDATE links SET swap_status = ?, updated_at = unixepoch() WHERE id = ?').run('reverted', linkId);
    } else {
      // Move mode
      if (fs.existsSync(qbtPath)) {
        try { fs.rmSync(qbtPath); } catch(e) {}
      }
      db.prepare('UPDATE links SET swap_status = ?, updated_at = unixepoch() WHERE id = ?').run('failed', linkId);
    }

    // Resume torrent only on failure
    await qbtClient.resume(hash);
    throw err;
  }
}
