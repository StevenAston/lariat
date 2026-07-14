import { QbtClient, TorrentInfo, TorrentFile } from './qbtClient';
import { ImportEvent } from './webhooks';
import { log } from './logger';

export interface ResolvedEvent extends ImportEvent {
  torrent: TorrentInfo;
  files: TorrentFile[];
}

export async function resolveTorrent(event: ImportEvent, qbtClient: QbtClient): Promise<ResolvedEvent | null> {
  const torrent = await qbtClient.torrentsByHash(event.hash);
  if (!torrent) {
    log.warn('Resolver', 'Hash not found in QBT', { hash: event.hash });
    return null;
  }

  if (torrent.state.includes('error')) {
    log.warn('Resolver', 'Torrent is in an error state', { hash: event.hash, state: torrent.state });
    return null;
  }

  const files = await qbtClient.torrentFiles(event.hash);

  return {
    ...event,
    torrent,
    files
  };
}
