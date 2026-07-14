import fs from 'fs';
import { ImportEvent } from './webhooks';
import { resolveTorrent } from './resolver';
import { processUpgrade } from './upgradeWorker';
import { detectFile } from './detector';
import { doSwap } from './swapWorker';
import { debounceRecheck } from './coordinator';
import { QbtClient } from './qbtClient';
import { getDb } from './db';
import { log } from './logger';
import { loadConfig } from './config';
import { doRecheck } from './recheckWorker';

export async function handleImportEvent(event: ImportEvent, qbtClient: QbtClient): Promise<void> {
  log.info('Orchestrator', `Handling import event for ${event.hash}`);

  // 1. Resolve Torrent
  const resolved = await resolveTorrent(event, qbtClient);
  if (!resolved) {
    log.debug('Orchestrator', `Could not resolve torrent for hash ${event.hash}`);
    return;
  }

  // 2. Handle Upgrades
  if (event.isUpgrade) {
    await processUpgrade(event, qbtClient);
  }

  // 3. Detect File
  let plexFileSize = 0;
  try {
    plexFileSize = fs.statSync(event.plexPath).size;
  } catch (err: any) {
    log.error('Orchestrator', `Could not stat plex file ${event.plexPath}: ${err.message}`);
    return;
  }

  const enriched = detectFile(resolved, plexFileSize);
  if (!enriched) {
    log.debug('Orchestrator', `File detection rejected or found no match for ${event.plexPath}`);
    return;
  }

  // 4. DB Insert
  const db = getDb();
  const qbtLandPath = `${resolved.torrent.save_path}/${enriched.qbtFile.name}`;

  const insertLink = db.prepare(`
    INSERT INTO links (
      hash, file_name, file_size, qbt_land_path, plex_land_path, 
      series_id, season_number, episode_file_id, movie_id, movie_file_id, swap_status, swap_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = insertLink.run(
    event.hash,
    enriched.qbtFile.name,
    enriched.qbtFile.size,
    qbtLandPath,
    event.plexPath,
    event.arrRefs.series_id || null,
    event.arrRefs.season_number || null,
    event.arrRefs.episode_file_id || null,
    event.arrRefs.movie_id || null,
    event.arrRefs.movie_file_id || null,
    'pending',
    loadConfig().importMode
  );
  const linkId = info.lastInsertRowid;

  // 5. Swap
  try {
    await doSwap(linkId as number, loadConfig().importMode === 'move' ? 'move' : 'copy');
  } catch (err: any) {
    log.error('Orchestrator', `Swap failed for link ${linkId}: ${err.message}`);
    db.prepare('UPDATE links SET swap_status = ? WHERE id = ?').run('failed', linkId);
    return;
  }

  // 6. Debounce Recheck
  const fileId = event.source === 'sonarr' ? event.arrRefs.episode_file_id?.toString() : event.arrRefs.movie_file_id?.toString();
  debounceRecheck(event.hash, fileId || event.plexPath, 0, loadConfig().debounceMs);
}

// Ensure the callback is set
import { setRecheckCallback } from './coordinator';
setRecheckCallback(async (hash: string) => {
  // We need a QBT client here. For simplicity, we could instantiate a new one or take it from somewhere.
  // In a real app, we'd have a central QbtClient instance.
  // Let's assume we create one using loadConfig.
  try {
    const config = loadConfig();
    const qbt = new QbtClient();
    await doRecheck(hash, qbt);
  } catch (err: any) {
    log.error('Orchestrator', `Failed to recheck ${hash}: ${err.message}`);
  }
});
