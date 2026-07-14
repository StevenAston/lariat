import { runReconciliation } from './reconciler';
import { QbtClient } from './qbtClient';
import { SonarrClient, RadarrClient } from './arrClient';
import { getDb } from './db';
import { debounceRecheck } from './coordinator';
import { loadConfig } from './config';
import { log } from './logger';
import path from 'path';

export async function runStartupIntegration(
  qbt: QbtClient,
  sonarr: SonarrClient,
  radarr: RadarrClient
) {
  log.info('Startup', 'Running startup integration...');

  // 1. Run reconciliation
  await runReconciliation(qbt, sonarr, radarr);

  // 2. Re-arm coordinators
  await rearmCoordinators(qbt);
}

export async function rearmCoordinators(qbt: QbtClient) {
  log.info('Startup', 'Re-arming coordinators...');
  const db = getDb();
  
  // Get all links that might be part of an incomplete pack.
  // We'll just load all links and group by hash.
  const links = db.prepare('SELECT * FROM links WHERE hash IS NOT NULL').all() as any[];
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
      const files = await qbt.torrentFiles(hash);
      const videoFiles = files.filter(f => videoExts.has(path.extname(f.name).toLowerCase()));
      const videoFileCount = videoFiles.length;

      // If it's fully imported already, we might not want to re-arm if it's already done.
      // But debounceRecheck will fire immediately if importsSeen >= videoFileCount.
      // If we don't want it to recheck already-completed torrents, we should check if the torrent state is already seeding/paused.
      // For this task, we will just re-arm. If it fires, our recheck logic handles idempotency.
      
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
