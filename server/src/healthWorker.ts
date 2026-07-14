import fs from 'fs/promises';
import { config } from './config';
import { getDb, getStoredHashes, saveLinkIntegrity } from './db';
import { log } from './logger';
import { normalisePath } from './config';
import { QbtClient } from './qbtClient';
import { classifyAnomaly, ClassifierInput, Anomaly } from './classifier';
import { resolvePhysicalPath, driveCoordinator, computeSparseMerkle } from './hasher';
import * as cron from 'node-cron';

export class HealthWorker {
  private cronJob: cron.ScheduledTask | null = null;

  constructor(private qbt: QbtClient) {}

  public startSchedule(cronExpression: string = '0 3 * * *') { // Default to 3 AM daily
    if (this.cronJob) this.cronJob.stop();
    this.cronJob = cron.schedule(cronExpression, () => {
      this.runSweep().catch(e => log.error('HealthWorker', 'Scheduled sweep failed', { error: e.message }));
    });
  }

  public stopSchedule() {
    if (this.cronJob) this.cronJob.stop();
  }

  public async runSweep() {
    log.info('HealthWorker', 'Starting scheduled health sweep');
    const db = getDb();
    const links = db.prepare('SELECT * FROM links').all() as any[];
    
    let processed = 0;
    for (const link of links) {
      await this.checkLinkHealth(link);
      processed++;
      if (processed % 100 === 0) {
        log.debug('HealthWorker', `Sweep progress: ${processed}/${links.length}`);
      }
    }
    log.info('HealthWorker', `Sweep complete. Checked ${links.length} links`);
  }

  public async checkLinkHealthById(linkId: number) {
    const db = getDb();
    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId) as any;
    if (!link) throw new Error(`Link not found: ${linkId}`);
    return this.checkLinkHealth(link);
  }

  private async checkLinkHealth(link: any) {
    const db = getDb();
    
    let qbtPresence = false;
    let qbtPathExists = false;
    let qbtPathIsSymlink = false;
    let qbtPathSymlinkTarget: string | null = null;
    let plexPathExists = false;
    let plexPathIsSymlink = false;

    // 1. Check QBT
    if (link.hash) {
      try {
        const torrent = await this.qbt.torrentsByHash(link.hash);
        if (torrent) qbtPresence = true;
      } catch (e) {
        // If error, assume it might still be there but API failed.
        // Wait, torrentsByHash returns null if not found.
        qbtPresence = false;
      }
    }

    // 2. Stat paths
    if (link.qbt_land_path) {
      try {
        const stats = await fs.lstat(link.qbt_land_path);
        qbtPathExists = true;
        if (stats.isSymbolicLink()) {
          qbtPathIsSymlink = true;
          qbtPathSymlinkTarget = await fs.readlink(link.qbt_land_path);
        }
      } catch (e) {}
    }

    if (link.plex_land_path) {
      try {
        const stats = await fs.lstat(link.plex_land_path);
        plexPathExists = true;
        if (stats.isSymbolicLink()) {
          plexPathIsSymlink = true;
        }
      } catch (e) {}
    }

    const input: ClassifierInput = {
      qbtPresence,
      arrPresence: true, // It's in the DB, assume we manage it
      expectedPlexPath: link.plex_land_path || null,
      qbtPathExists,
      qbtPathIsSymlink,
      qbtPathSymlinkTarget,
      plexPathExists,
      plexPathIsSymlink
    };

    let anomaly = classifyAnomaly(input);
    
    // Integrity Check (Phase 4)
    let integrityChecked = false;
    if (config.integrity.enabled && anomaly === Anomaly.Healthy && link.plex_land_path && plexPathExists) {
      try {
        const stats = await fs.stat(link.plex_land_path);
        const stored = getStoredHashes(link.id);
        
        if (stored.root && stored.sizeAtHash !== null) {
          if (stats.size !== stored.sizeAtHash) {
            anomaly = Anomaly.IntegrityFail;
          } else {
            // Need to rehash
            const { physicalPath, driveLetter } = await resolvePhysicalPath(link.plex_land_path);
            const currentHash = await driveCoordinator.runExclusive(driveLetter, () => 
              computeSparseMerkle(physicalPath, stats.size)
            );
            if (currentHash.root !== stored.root) {
              anomaly = Anomaly.IntegrityFail;
            }
          }
          integrityChecked = true;
        } else {
          // No stored hash, compute and save it as baseline
          const { physicalPath, driveLetter } = await resolvePhysicalPath(link.plex_land_path);
          const currentHash = await driveCoordinator.runExclusive(driveLetter, () => 
            computeSparseMerkle(physicalPath, stats.size)
          );
          saveLinkIntegrity(link.id, currentHash);
          integrityChecked = true;
        }
      } catch (e: any) {
        log.error('HealthWorker', `Integrity check failed for link ${link.id}`, { error: e.message });
      }
    }

    const detail = JSON.stringify({
      qbtPathExists,
      qbtPathIsSymlink,
      plexPathExists,
      plexPathIsSymlink,
      qbtPresence,
      integrityChecked
    });

    // 3. Write health_checks row
    const result = db.prepare(`
      INSERT INTO health_checks (link_id, status, detail)
      VALUES (?, ?, ?)
    `).run(link.id, anomaly, detail);

    const healthCheckId = result.lastInsertRowid;

    // 4. Update links
    const prevHealth = link.current_health;
    db.prepare(`
      UPDATE links SET current_health = ?, last_health_check_id = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(anomaly, healthCheckId, link.id);

    // 5. Check transitions
    if (prevHealth === Anomaly.Healthy && anomaly !== Anomaly.Healthy) {
      db.prepare(`
        INSERT INTO events (link_id, type, message, detail)
        VALUES (?, 'degradation', 'Link health degraded', ?)
      `).run(link.id, JSON.stringify({ from: prevHealth, to: anomaly }));
      
      log.warn('HealthWorker', `Link ${link.id} health degraded to ${anomaly}`);
    }

    return { anomaly, prevHealth, healthCheckId };
  }
}
