import fs from 'fs';
import path from 'path';
import { getDb } from './db';
import { QbtClient } from './qbtClient';
import { ImportEvent } from './webhooks';
import { log } from './logger';
import { normalisePath } from './config';
import { debounceRecheck } from './coordinator';

export async function processUpgrade(event: ImportEvent, qbtClient: QbtClient): Promise<void> {
  if (!event.isUpgrade || !event.deletedFiles || event.deletedFiles.length === 0) {
    return;
  }

  const db = getDb();
  
  for (const deletedFile of event.deletedFiles) {
    const normDeleted = normalisePath(deletedFile);
    const link = db.prepare('SELECT id, hash, qbt_land_path, file_name FROM links WHERE plex_land_path = ? OR lower(plex_land_path) = ?').get(deletedFile, normDeleted) as any;
    
    if (link && link.hash) {
      if (link.hash === event.hash) continue; // Same torrent? Unusual but possible.

      log.info('UpgradeWorker', `Upgrade detected. Processing old torrent ${link.hash}`);
      
      // 1. Pause old torrent
      await qbtClient.pause(link.hash);
      
      // 2. Set file priority to 0 (Do not download) so QBT doesn't re-download it
      try {
        const files = await qbtClient.torrentFiles(link.hash);
        const qbtFile = files.find(f => f.name === link.file_name);
        if (qbtFile) {
          await qbtClient.filePrio(link.hash, qbtFile.index, 0);
          log.debug('UpgradeWorker', `Set priority to 0 for file ${link.file_name} in ${link.hash}`);
        }
      } catch (err: any) {
        log.warn('UpgradeWorker', `Could not set priority for ${link.hash}: ${err.message}`);
      }

      // 3. Delete the symlink so QBT doesn't overwrite the new upgraded file on recheck
      if (fs.existsSync(link.qbt_land_path)) {
        try {
          fs.rmSync(link.qbt_land_path);
          log.debug('UpgradeWorker', `Removed old symlink at ${link.qbt_land_path}`);
        } catch (e: any) {
          log.error('UpgradeWorker', `Failed to remove old symlink at ${link.qbt_land_path}: ${e.message}`);
        }
      }

      // 4. Update DB
      db.prepare('UPDATE links SET swap_status = ? WHERE id = ?').run('upgraded', link.id);
      
      const insertEvent = db.prepare(`
        INSERT INTO events (torrent_hash, type, message, detail)
        VALUES (?, ?, ?, ?)
      `);
      insertEvent.run(link.hash, 'upgrade_detected', 'Torrent paused and file unlinked due to upgrade', JSON.stringify({ newHash: event.hash }));

      // 5. Enqueue recheck for old torrent so it resumes seeding the other files (if it's a pack)
      debounceRecheck(link.hash, `upgrade_${link.id}`, 0, 500); // short debounce
    }
  }
}
