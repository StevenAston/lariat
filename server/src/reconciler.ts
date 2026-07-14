import fs from 'fs/promises';
import { getDb } from './db';
import { log } from './logger';
import { normalisePath } from './config';
import { QbtClient } from './qbtClient';
import { SonarrClient, RadarrClient } from './arrClient';
import { buildQbtPathMap } from './qbtPathMap';
import { classifyAnomaly, ClassifierInput, Anomaly } from './classifier';
import { Database } from 'better-sqlite3';

export async function runReconciliation(
  qbt: QbtClient,
  sonarr: SonarrClient,
  radarr: RadarrClient
) {
  log.info('Reconciliation', 'Starting reconciliation run...');
  const db = getDb();

  // 1. Fetch inventories
  const qbtMap = await buildQbtPathMap(qbt);
  
  const sonarrFiles = await sonarr.listEpisodeFiles().catch(e => {
    log.warn('Reconciliation', 'Failed to fetch Sonarr files', { error: e.message });
    return [];
  });
  
  const radarrFiles = await radarr.listMovieFiles().catch(e => {
    log.warn('Reconciliation', 'Failed to fetch Radarr files', { error: e.message });
    return [];
  });

  const arrMap = new Map<string, any>();
  for (const sf of sonarrFiles) {
    arrMap.set(normalisePath(sf.path), { type: 'sonarr', ...sf });
  }
  for (const rf of radarrFiles) {
    arrMap.set(normalisePath(rf.path), { type: 'radarr', ...rf });
  }

  // 2. Discover entities
  interface ReconEntity {
    qbtPathOrig?: string;
    qbtPathNorm?: string;
    plexPathOrig?: string;
    plexPathNorm?: string;
    qbtInfo?: any;
    arrInfo?: any;
    dbLink?: any;
  }

  const entities: ReconEntity[] = [];
  const existingLinks = db.prepare('SELECT * FROM links').all() as any[];
  
  const linkByQbtPath = new Map<string, any>();
  const linkByPlexPath = new Map<string, any>();
  
  for (const link of existingLinks) {
    if (link.qbt_land_path) linkByQbtPath.set(normalisePath(link.qbt_land_path), link);
    if (link.plex_land_path) linkByPlexPath.set(normalisePath(link.plex_land_path), link);
  }

  const processedArrPaths = new Set<string>();

  // Process QBT map
  for (const [qbtPathNorm, qbtEntry] of qbtMap.entries()) {
    const qbtPathOrig = qbtEntry.qbtPath;
    let plexPathOrig: string | undefined;
    let plexPathNorm: string | undefined;

    // Fast path: does this QBT path exist in DB?
    let dbLink = linkByQbtPath.get(qbtPathNorm);
    if (dbLink && dbLink.plex_land_path) {
      plexPathOrig = dbLink.plex_land_path;
      plexPathNorm = normalisePath(plexPathOrig!);
    } else {
      // Not in DB by QBT path. Let's see if it's a symlink pointing to Plex path.
      try {
        const stats = await fs.lstat(qbtPathOrig);
        if (stats.isSymbolicLink()) {
          const target = await fs.readlink(qbtPathOrig);
          plexPathOrig = target;
          plexPathNorm = normalisePath(target);
          // If we found a target, try to find a DB link for that target
          dbLink = linkByPlexPath.get(plexPathNorm);
        }
      } catch (e) {
        // Ignored
      }
    }

    let arrInfo = undefined;
    if (plexPathNorm) {
      arrInfo = arrMap.get(plexPathNorm);
      if (arrInfo) {
        processedArrPaths.add(plexPathNorm);
      }
    }

    entities.push({
      qbtPathOrig,
      qbtPathNorm,
      plexPathOrig,
      plexPathNorm,
      qbtInfo: qbtEntry,
      arrInfo,
      dbLink
    });
  }

  // Process remaining Arr files
  for (const [plexPathNorm, arrInfo] of arrMap.entries()) {
    if (!processedArrPaths.has(plexPathNorm)) {
      const plexPathOrig = arrInfo.path;
      const dbLink = linkByPlexPath.get(plexPathNorm);
      entities.push({
        plexPathOrig,
        plexPathNorm,
        arrInfo,
        dbLink
      });
    }
  }

  // Process remaining DB links that had no QBT path and no Arr file (orphaned DB entries)
  for (const link of existingLinks) {
    const qNorm = link.qbt_land_path ? normalisePath(link.qbt_land_path) : undefined;
    const pNorm = link.plex_land_path ? normalisePath(link.plex_land_path) : undefined;
    
    // Check if we already created an entity for this
    let found = false;
    for (const ent of entities) {
      if ((qNorm && ent.qbtPathNorm === qNorm) || (pNorm && ent.plexPathNorm === pNorm)) {
        found = true;
        break;
      }
    }
    
    if (!found) {
      entities.push({
        qbtPathOrig: link.qbt_land_path,
        qbtPathNorm: qNorm,
        plexPathOrig: link.plex_land_path,
        plexPathNorm: pNorm,
        dbLink: link
      });
    }
  }

  // 3. Classify and Upsert
  const summary = {
    healthy: 0,
    unprocessed: 0,
    orphan_symlink: 0,
    double_symlink: 0,
    wrong_target: 0,
    missing_real_file: 0,
    no_torrent: 0,
    torrent_no_file: 0,
    unmanaged_torrent: 0,
    total: 0
  };

  const upsertTorrentStmt = db.prepare(`
    INSERT INTO torrents (hash, name, save_path, category, tags, size, added_on, completion_on, state)
    VALUES (@hash, @name, @save_path, @category, @tags, @size, @added_on, @completion_on, @state)
    ON CONFLICT(hash) DO UPDATE SET
      name=excluded.name,
      save_path=excluded.save_path,
      category=excluded.category,
      tags=excluded.tags,
      size=excluded.size,
      added_on=excluded.added_on,
      completion_on=excluded.completion_on,
      state=excluded.state
  `);

  const updateLinkStmt = db.prepare(`
    UPDATE links SET
      hash = @hash,
      file_name = @file_name,
      file_size = @file_size,
      qbt_land_path = @qbt_land_path,
      plex_land_path = @plex_land_path,
      series_id = @series_id,
      season_number = @season_number,
      episode_file_id = @episode_file_id,
      movie_id = @movie_id,
      movie_file_id = @movie_file_id,
      current_health = @current_health,
      updated_at = unixepoch()
    WHERE id = @id
  `);

  const insertLinkStmt = db.prepare(`
    INSERT INTO links (
      hash, file_name, file_size, qbt_land_path, plex_land_path,
      series_id, season_number, episode_file_id,
      movie_id, movie_file_id,
      swap_status, swap_mode, current_health
    ) VALUES (
      @hash, @file_name, @file_size, @qbt_land_path, @plex_land_path,
      @series_id, @season_number, @episode_file_id,
      @movie_id, @movie_file_id,
      @swap_status, @swap_mode, @current_health
    )
  `);

  const updateTorrentLinkStmt = db.prepare(`UPDATE links SET hash = @hash WHERE id = @id`);

  for (const ent of entities) {
    summary.total++;
    let qbtPathExists = false;
    let qbtPathIsSymlink = false;
    let qbtPathSymlinkTarget: string | null = null;
    let plexPathExists = false;
    let plexPathIsSymlink = false;

    if (ent.qbtPathOrig) {
      try {
        const stats = await fs.lstat(ent.qbtPathOrig);
        qbtPathExists = true;
        if (stats.isSymbolicLink()) {
          qbtPathIsSymlink = true;
          qbtPathSymlinkTarget = await fs.readlink(ent.qbtPathOrig);
        }
      } catch (e) {}
    }

    if (ent.plexPathOrig) {
      try {
        const stats = await fs.lstat(ent.plexPathOrig);
        plexPathExists = true;
        if (stats.isSymbolicLink()) {
          plexPathIsSymlink = true;
        }
      } catch (e) {}
    }

    const input: ClassifierInput = {
      qbtPresence: !!ent.qbtInfo,
      arrPresence: !!ent.arrInfo,
      expectedPlexPath: ent.plexPathOrig || null,
      qbtPathExists,
      qbtPathIsSymlink,
      qbtPathSymlinkTarget,
      plexPathExists,
      plexPathIsSymlink
    };

    const anomaly = classifyAnomaly(input);
    
    // Increment summary
    if (anomaly in summary) {
      (summary as any)[anomaly]++;
    }

    // Upsert torrent
    if (ent.qbtInfo) {
      upsertTorrentStmt.run({
        hash: ent.qbtInfo.torrent.hash,
        name: ent.qbtInfo.torrent.name,
        save_path: ent.qbtInfo.torrent.save_path,
        category: ent.qbtInfo.torrent.category,
        tags: ent.qbtInfo.torrent.tags,
        size: ent.qbtInfo.torrent.size,
        added_on: ent.qbtInfo.torrent.added_on,
        completion_on: ent.qbtInfo.torrent.completion_on,
        state: ent.qbtInfo.torrent.state
      });
    }

    // Prepare link data
    const linkParams = {
      hash: ent.qbtInfo?.hash || ent.dbLink?.hash || null,
      file_name: ent.qbtInfo?.file.name || ent.dbLink?.file_name || null,
      file_size: ent.qbtInfo?.file.size || ent.arrInfo?.size || ent.dbLink?.file_size || null,
      qbt_land_path: ent.qbtPathOrig || ent.dbLink?.qbt_land_path || null,
      plex_land_path: ent.plexPathOrig || ent.dbLink?.plex_land_path || null,
      series_id: ent.arrInfo?.type === 'sonarr' ? ent.arrInfo.seriesId : null,
      season_number: ent.arrInfo?.type === 'sonarr' ? ent.arrInfo.seasonNumber : null,
      episode_file_id: ent.arrInfo?.type === 'sonarr' ? ent.arrInfo.id : null,
      movie_id: ent.arrInfo?.type === 'radarr' ? ent.arrInfo.movieId : null,
      movie_file_id: ent.arrInfo?.type === 'radarr' ? ent.arrInfo.id : null,
      current_health: anomaly
    };

    // Keep existing Arr IDs if not provided in this pass but present in dbLink
    if (ent.dbLink && !ent.arrInfo) {
      linkParams.series_id = ent.dbLink.series_id;
      linkParams.season_number = ent.dbLink.season_number;
      linkParams.episode_file_id = ent.dbLink.episode_file_id;
      linkParams.movie_id = ent.dbLink.movie_id;
      linkParams.movie_file_id = ent.dbLink.movie_file_id;
    }

    // Unmanaged torrents don't necessarily need a link row, unless we want to track them.
    // Spec says: "identify batch candidates... upsert torrents/links". 
    // Unmanaged torrents have no link yet. Should we insert them?
    // It says "Anything where the owning torrent cannot be found is flagged immediately"
    // For UnmanagedTorrent, we could create a link with null plex_land_path to represent it, 
    // or just let it exist in torrents table. Let's create a link if we have qbt_land_path.

    // Let's only insert if we have some meaningful data
    if (linkParams.qbt_land_path || linkParams.plex_land_path) {
      if (ent.dbLink) {
        updateLinkStmt.run({ id: ent.dbLink.id, ...linkParams });
      } else {
        insertLinkStmt.run({
          ...linkParams,
          swap_status: anomaly === Anomaly.Healthy ? 'linked' : 'pending', // best guess
          swap_mode: 'copy' // best guess for new untracked links
        });
      }
    }
  }

  log.info('Reconciliation', 'Reconciliation complete', summary);
  
  // Log summary event to events table (optional but good for SPEC)
  db.prepare(`
    INSERT INTO events (type, message, detail) 
    VALUES ('reconciliation', 'Reconciliation complete', ?)
  `).run(JSON.stringify(summary));

  return summary;
}
