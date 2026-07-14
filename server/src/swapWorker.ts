import fs from 'fs';
import path from 'path';
import { getDb } from './db';
import { log } from './logger';

export async function doSwap(linkId: number, mode: 'copy' | 'move' = 'copy'): Promise<void> {
  const db = getDb();
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId) as any;

  if (!link) {
    throw new Error(`Link not found: ${linkId}`);
  }

  const qbtPath = link.qbt_land_path;
  const plexPath = link.plex_land_path;

  if (!fs.existsSync(qbtPath)) {
    throw new Error(`QBT file missing: ${qbtPath}`);
  }

  // Ensure Plex file exists so we are actually swapping (upgrading or replacing)
  // Wait, if it's an initial import, the Plex file might exist because *arr just imported it.
  // Actually, *arr moved it to plexPath, so it MUST exist.
  if (!fs.existsSync(plexPath)) {
    throw new Error(`Plex file missing: ${plexPath}`);
  }

  if (mode === 'copy') {
    log.info('SwapWorker', `Copying ${qbtPath} over ${plexPath}`);
    fs.copyFileSync(qbtPath, plexPath);
  } else if (mode === 'move') {
    log.info('SwapWorker', `Moving (actually renaming) ${qbtPath} over ${plexPath}`);
    fs.renameSync(qbtPath, plexPath);
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }

  const update = db.prepare('UPDATE links SET swap_status = ?, updated_at = unixepoch() WHERE id = ?');
  update.run('swapped', linkId);

  const insertEvent = db.prepare(`
    INSERT INTO events (link_id, torrent_hash, type, message, detail)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertEvent.run(
    linkId,
    link.hash,
    'swap',
    `Successfully swapped file using mode: ${mode}`,
    JSON.stringify({ mode, qbtPath, plexPath })
  );
}
