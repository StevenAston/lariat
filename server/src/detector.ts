import path from 'path';
import { ResolvedEvent } from './resolver';
import { TorrentFile } from './qbtClient';
import { log } from './logger';
import { normalisePath } from './config';

export interface EnrichedEvent extends ResolvedEvent {
  qbtFile: TorrentFile;
}

export function detectFile(event: ResolvedEvent, plexFileSize: number): EnrichedEvent | null {
  const normPlexPath = normalisePath(event.plexPath);
  const plexBasename = path.basename(normPlexPath);

  // Find matches by basename
  const candidates = event.files.filter(f => normalisePath(f.name).endsWith(plexBasename));

  if (candidates.length === 0) {
    log.warn('Detector', 'No matching file found in torrent', { hash: event.hash, plexPath: event.plexPath });
    return null;
  }

  // If multiple candidates, we might need to pick the closest size. Let's just pick the first for now.
  let qbtFile = candidates[0];
  if (candidates.length > 1) {
    const exactMatch = candidates.find(f => Math.abs(f.size - plexFileSize) < 200 * 1024 * 1024);
    if (exactMatch) {
      qbtFile = exactMatch;
    }
  }

  // Size diff > 200MB
  if (Math.abs(qbtFile.size - plexFileSize) > 200 * 1024 * 1024) {
    log.warn('Detector', 'File size difference > 200MB', { 
      hash: event.hash, 
      qbtSize: qbtFile.size, 
      plexSize: plexFileSize 
    });
    return null;
  }

  // Sample heuristic: < 100MB and name contains 'sample'
  const normName = normalisePath(qbtFile.name);
  if (qbtFile.size < 100 * 1024 * 1024 && normName.includes('sample')) {
    log.warn('Detector', 'File appears to be a sample, ignoring', { hash: event.hash, name: qbtFile.name });
    return null;
  }

  return {
    ...event,
    qbtFile
  };
}
