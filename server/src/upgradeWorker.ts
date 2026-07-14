import { getDb } from './db';
import { QbtClient } from './qbtClient';
import { ImportEvent } from './webhooks';
import { log } from './logger';
import { normalisePath } from './config';

export async function processUpgrade(event: ImportEvent, qbtClient: QbtClient): Promise<void> {
  if (!event.isUpgrade || !event.deletedFiles || event.deletedFiles.length === 0) {
    return;
  }

  const db = getDb();
  
  // Find the old hash(es) associated with the deleted files
  // Since we normalize paths, we should ideally normalize the deleted files to match the DB
  const oldHashes = new Set<string>();

  for (const deletedFile of event.deletedFiles) {
    const normDeleted = normalisePath(deletedFile);
    
    // In SQLite we can just fetch all and filter, or we can assume the DB paths are stored somewhat normalized, 
    // but they are stored exact and we normalize at runtime, or we query exact.
    // In Task 0.2 we added config.normalisePath. Let's do a case-insensitive search if we must, or just exact match if we store them exactly.
    const link = db.prepare('SELECT hash FROM links WHERE plex_land_path = ? OR lower(plex_land_path) = ?').get(deletedFile, normDeleted) as any;
    
    if (link && link.hash) {
      oldHashes.add(link.hash);
    }
  }

  for (const oldHash of oldHashes) {
    // If it's the exact same hash (somehow), don't pause it
    if (oldHash === event.hash) {
      continue;
    }

    log.info('UpgradeWorker', `Upgrade detected. Pausing old torrent ${oldHash}`);
    await qbtClient.pause(oldHash);

    const insertEvent = db.prepare(`
      INSERT INTO events (torrent_hash, type, message, detail)
      VALUES (?, ?, ?, ?)
    `);
    insertEvent.run(oldHash, 'upgrade_detected', 'Torrent paused due to upgrade', JSON.stringify({ newHash: event.hash }));
  }
}
