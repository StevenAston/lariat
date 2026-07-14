import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from './db';
import { QbtClient } from './qbtClient';
import { SonarrClient, RadarrClient } from './arrClient';
import { log } from './logger';

export interface SystemHealth {
  db: boolean;
  qbt: boolean;
  sonarr: boolean;
  radarr: boolean;
  symlink_privilege: boolean;
}

let cachedHealth: SystemHealth | null = null;

export async function checkSystemHealth(): Promise<SystemHealth> {
  const health: SystemHealth = {
    db: false,
    qbt: false,
    sonarr: false,
    radarr: false,
    symlink_privilege: false
  };

  // 1. Check DB
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    health.db = true;
  } catch (err: any) {
    log.error('HealthCheck', 'DB check failed', { error: err.message });
  }

  // 2. Check QBT
  try {
    const qbt = new QbtClient();
    // A simple call to ensure auth works
    await qbt.torrentsInfo();
    health.qbt = true;
  } catch (err: any) {
    log.error('HealthCheck', 'QBT check failed', { error: err.message });
  }

  // 3. Check Sonarr (cheap endpoint is /api/v3/system/status, but we can just ask for series list page 1 or similar. Let's try /api/v3/system/status manually using base class or just wrap a cheap call.)
  try {
    const sonarr = new SonarrClient();
    // getSeries(1) might return 404 if not found, but it proves connectivity.
    // Instead, we can add getSystemStatus to ArrClient. For now, try fetching an invalid ID and catch 404.
    try {
      await sonarr.getSeries(999999);
      health.sonarr = true;
    } catch (e: any) {
      if (e.message.includes('404')) {
        health.sonarr = true;
      } else {
        throw e;
      }
    }
  } catch (err: any) {
    log.error('HealthCheck', 'Sonarr check failed', { error: err.message });
  }

  // 4. Check Radarr
  try {
    const radarr = new RadarrClient();
    try {
      await radarr.getMovie(999999);
      health.radarr = true;
    } catch (e: any) {
      if (e.message.includes('404')) {
        health.radarr = true;
      } else {
        throw e;
      }
    }
  } catch (err: any) {
    log.error('HealthCheck', 'Radarr check failed', { error: err.message });
  }

  // 5. Check symlink privilege
  const tempDir = os.tmpdir();
  const targetPath = path.join(tempDir, `lariat-target-${Date.now()}.txt`);
  const symlinkPath = path.join(tempDir, `lariat-symlink-${Date.now()}.txt`);
  
  try {
    fs.writeFileSync(targetPath, 'test');
    // On Windows, type must be 'file', 'dir', or 'junction'
    fs.symlinkSync(targetPath, symlinkPath, 'file');
    const read = fs.readlinkSync(symlinkPath);
    if (read) {
      health.symlink_privilege = true;
    }
    fs.unlinkSync(symlinkPath);
  } catch (err: any) {
    log.critical('HealthCheck', 'Symlink privilege check failed', { error: err.message });
  } finally {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
  }

  cachedHealth = health;
  return health;
}

export function getCachedHealth(): SystemHealth | null {
  return cachedHealth;
}
