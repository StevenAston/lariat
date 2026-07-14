import path from 'path';
import { QbtClient, TorrentInfo, TorrentFile } from './qbtClient';
import { normalisePath } from './config';
import { log } from './logger';

export interface QbtMapEntry {
  hash: string;
  torrent: TorrentInfo;
  file: TorrentFile;
  qbtPath: string;
}

export async function buildQbtPathMap(qbt: QbtClient): Promise<Map<string, QbtMapEntry>> {
  const map = new Map<string, QbtMapEntry>();
  
  log.info('QbtPathMap', 'Fetching all torrents from QBT...');
  const torrents = await qbt.torrentsInfo();
  log.info('QbtPathMap', `Fetched ${torrents.length} torrents. Building path map...`);
  
  let processed = 0;
  for (const torrent of torrents) {
    const files = await qbt.torrentFiles(torrent.hash);
    for (const file of files) {
      const qbtPath = path.join(torrent.save_path, file.name);
      const normPath = normalisePath(qbtPath);
      map.set(normPath, { hash: torrent.hash, torrent, file, qbtPath });
    }
    processed++;
    if (processed % 100 === 0) {
      log.debug('QbtPathMap', `Processed ${processed}/${torrents.length} torrents...`);
    }
  }
  
  log.info('QbtPathMap', `Path map built with ${map.size} files.`);
  return map;
}
