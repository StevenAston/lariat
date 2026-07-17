import { runReconciliation } from './reconciler';
import { QbtClient } from './qbtClient';
import { SonarrClient, RadarrClient } from './arrClient';
import { getDb } from './db';
import { debounceRecheck } from './coordinator';
import { loadConfig } from './config';
import { log } from './logger';
import path from 'path';
import { requestApproval } from './approval';

export async function runStartupIntegration(
  qbt: QbtClient,
  sonarr: SonarrClient,
  radarr: RadarrClient
) {
  log.info('Startup', 'Running startup integration...');

  // 1. Run reconciliation
  await runReconciliation(qbt, sonarr, radarr);

  // Fetch categories from *arrs
  const sonarrCats = await sonarr.getQbtCategories();
  const radarrCats = await radarr.getQbtCategories();

  // 2. Re-arm coordinators
  await rearmCoordinators(qbt, sonarrCats, radarrCats);
}

export async function rearmCoordinators(
  qbt: QbtClient, 
  sonarrCats: { category?: string, importedCategory?: string } = {}, 
  radarrCats: { category?: string, importedCategory?: string } = {}
) {
  log.info('Startup', 'Re-arming coordinators...');
  const db = getDb();
  
  // Get all links that might be part of an incomplete pack.
  // We filter out torrents that have already been successfully rechecked,
  // or that are older than 24 hours to prevent rechecking the entire library on startup.
  const links = db.prepare(`
    SELECT l.* FROM links l
    LEFT JOIN torrents t ON l.hash = t.hash
    WHERE l.hash IS NOT NULL 
      AND (t.state != 'rechecked' OR t.state IS NULL)
      AND l.updated_at > (unixepoch() - 86400)
  `).all() as any[];
  const byHash = new Map<string, any[]>();
  
  for (const link of links) {
    if (!byHash.has(link.hash)) {
      byHash.set(link.hash, []);
    }
    byHash.get(link.hash)!.push(link);
  }

  const config = loadConfig();
  const videoExts = new Set(['.mkv', '.mp4', '.avi']);

  for (const [hash, hashLinks] of byHash.entries()) {
    try {
      const torrentInfo = await qbt.torrentsByHash(hash);
      if (!torrentInfo) continue;

      const tCat = torrentInfo.category;

      // 1. If it's the normal grab category, ignore it completely.
      if ((sonarrCats.category && tCat === sonarrCats.category) || 
          (radarrCats.category && tCat === radarrCats.category)) {
        log.debug('Startup', `Ignoring hash ${hash} because it is in the normal grab category: ${tCat}`);
        continue;
      }

      // 2. Enforce imported category if it is configured in either *arr app.
      if (sonarrCats.importedCategory || radarrCats.importedCategory) {
        let isImportedCat = false;
        if (sonarrCats.importedCategory && tCat === sonarrCats.importedCategory) isImportedCat = true;
        if (radarrCats.importedCategory && tCat === radarrCats.importedCategory) isImportedCat = true;

        if (!isImportedCat) {
          log.debug('Startup', `Ignoring hash ${hash} because category ${tCat} is not the imported category.`);
          continue;
        }
      }

      // 3. If it's already seeding or pausedUP, we don't need to recheck it!
      // This is especially useful for backfilling old torrents that were processed before we added 'rechecked_at'.
      const tState = torrentInfo.state;
      if (tState === 'pausedUP' || tState === 'seeding' || tState === 'stalledUP' || tState === 'forcedUP' || tState === 'uploading') {
        log.info('Startup', `Hash ${hash} is already fully downloaded and seeding (${tState}). Marking as rechecked in DB.`);
        db.prepare('UPDATE torrents SET state = ?, rechecked_at = unixepoch() WHERE hash = ?').run('rechecked', hash);
        continue;
      }

      const files = await qbt.torrentFiles(hash);
      const videoFiles = files.filter(f => videoExts.has(path.extname(f.name).toLowerCase()));
      const videoFileCount = videoFiles.length;

      // If it's fully imported already, we might not want to re-arm if it's already done.
      // But debounceRecheck will fire immediately if importsSeen >= videoFileCount.
      // If we don't want it to recheck already-completed torrents, we should check if the torrent state is already seeding/paused.
      // For this task, we will just re-arm. If it fires, our recheck logic handles idempotency.
      
      try {
        await requestApproval('Startup Re-arm', `Re-arm recheck coordinator for hash ${hash}`);
      } catch (e: any) {
        log.warn('Startup', `Re-arming aborted by user for hash ${hash}`);
        continue;
      }
      
      for (const link of hashLinks) {
        const fileId = link.episode_file_id ? link.episode_file_id.toString() : 
                      (link.movie_file_id ? link.movie_file_id.toString() : link.plex_land_path);
        
        debounceRecheck(hash, fileId, videoFileCount, config.debounceMs);
      }
    } catch (e: any) {
      log.warn('Startup', `Could not re-arm coordinator for hash ${hash}`, { error: e.message });
    }
  }
}
