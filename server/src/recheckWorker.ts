import { QbtClient } from './qbtClient';
import { getDb } from './db';
import { log } from './logger';

export async function doRecheck(hash: string, qbtClient: QbtClient, pollIntervalMs: number = 2000, maxAttempts: number = 30): Promise<void> {
  log.info('RecheckWorker', `Initiating recheck for ${hash}`);
  await qbtClient.recheck(hash);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const torrent = await qbtClient.torrentsByHash(hash);
    if (!torrent) {
      log.error('RecheckWorker', `Torrent not found during recheck polling`, { hash });
      throw new Error(`Torrent ${hash} missing`);
    }

    const state = torrent.state;
    log.debug('RecheckWorker', `Poll attempt ${attempt}/${maxAttempts}, state: ${state}`, { hash });

    if (state === 'checkingUP' || state === 'checkingDL' || state === 'checkingResumeData') {
      await new Promise(r => setTimeout(r, pollIntervalMs));
      continue;
    }

    if (state === 'pausedUP' || state === 'pausedDL' || state === 'stalledUP' || state === 'stalledDL' || state === 'uploading' || state === 'downloading') {
      log.info('RecheckWorker', `Recheck complete for ${hash}`, { state });
      
      const db = getDb();
      const update = db.prepare('UPDATE torrents SET state = ? WHERE hash = ?');
      update.run('rechecked', hash);

      log.info('RecheckWorker', `Resuming ${hash}`);
      await qbtClient.resume(hash);
      
      const insertEvent = db.prepare(`
        INSERT INTO events (torrent_hash, type, message)
        VALUES (?, ?, ?)
      `);
      insertEvent.run(hash, 'recheck_complete', `Recheck finished and torrent resumed`);
      return;
    }

    // Unrecognized or other intermediate state
    log.debug('RecheckWorker', `Unknown or intermediate state during recheck: ${state}`, { hash });
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  log.error('RecheckWorker', `Recheck polling timed out for ${hash}`);
  throw new Error(`Recheck timeout for ${hash}`);
}
