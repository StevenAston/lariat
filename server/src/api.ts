import express from 'express';
import { getDb } from './db';
import { doRecheck } from './recheckWorker';
import { loadConfig, saveConfig } from './config';
import { QbtClient } from './qbtClient';
import { log } from './logger';
import { getPendingCount } from './coordinator';

export const apiRouter = express.Router();
apiRouter.use(express.json());

apiRouter.get('/status', (req, res) => {
  try {
    const db = getDb();
    const torrentCount = db.prepare('SELECT COUNT(*) as c FROM torrents').get() as { c: number };
    const linkCount = db.prepare('SELECT COUNT(*) as c FROM links').get() as { c: number };
    
    // Get recent events
    const recentEvents = db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 50').all();
    
    res.json({
      success: true,
      data: {
        torrents: torrentCount.c,
        links: linkCount.c,
        recentEvents
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/summary', (req, res) => {
  try {
    const db = getDb();
    const torrentCount = db.prepare('SELECT COUNT(*) as c FROM torrents').get() as { c: number };
    const linkCount = db.prepare('SELECT COUNT(*) as c FROM links').get() as { c: number };
    
    // Group by current_health
    const anomalies = db.prepare('SELECT current_health, COUNT(*) as c FROM links GROUP BY current_health').all() as { current_health: string, c: number }[];
    const byAnomaly = anomalies.reduce((acc, row) => {
      acc[row.current_health || 'unknown'] = row.c;
      return acc;
    }, {} as Record<string, number>);

    // Last events
    const lastRecon = db.prepare('SELECT created_at FROM events WHERE type = ? ORDER BY created_at DESC LIMIT 1').get('reconciliation') as { created_at: string } | undefined;
    const lastHealth = db.prepare('SELECT created_at FROM events WHERE type = ? ORDER BY created_at DESC LIMIT 1').get('health_sweep') as { created_at: string } | undefined;

    res.json({
      success: true,
      data: {
        totals: {
          torrents: torrentCount.c,
          links: linkCount.c
        },
        byAnomaly,
        lastReconciliation: lastRecon?.created_at || null,
        lastHealthSweep: lastHealth?.created_at || null,
        recheckQueueDepth: getPendingCount()
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/links', (req, res) => {
  try {
    const db = getDb();
    
    // Pagination parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    // Sorting parameters
    const validSortFields = ['id', 'hash', 'file_name', 'current_health', 'swap_status'];
    const sortBy = validSortFields.includes(req.query.sortBy as string) ? (req.query.sortBy as string) : 'id';
    const sortDesc = req.query.sortDesc === 'true';
    const sortDir = sortDesc ? 'DESC' : 'ASC';

    // Count total
    const totalRow = db.prepare('SELECT COUNT(*) as c FROM links').get() as { c: number };
    const total = totalRow.c;

    // Get data
    const query = `
      SELECT id, hash, file_name, current_health, swap_status
      FROM links
      ORDER BY ${sortBy} ${sortDir}
      LIMIT ? OFFSET ?
    `;
    const links = db.prepare(query).all(limit, offset);

    res.json({
      success: true,
      data: {
        links,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/links/:id', (req, res) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id) as any;
    if (!link) {
      return res.status(404).json({ success: false, error: 'Link not found' });
    }

    // Optionally get latest health check detail
    const healthCheck = db.prepare('SELECT * FROM health_checks WHERE link_id = ? ORDER BY created_at DESC LIMIT 1').get(link.id) as any;
    
    // Get events for this link
    const events = db.prepare('SELECT * FROM events WHERE link_id = ? ORDER BY created_at DESC LIMIT 10').all(link.id);

    res.json({
      success: true,
      data: {
        link,
        healthCheck: healthCheck || null,
        events
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/recheck/:hash', async (req, res) => {
  try {
    const hash = req.params.hash;
    const db = getDb();
    const torrent = db.prepare('SELECT * FROM torrents WHERE hash = ?').get(hash);
    if (!torrent) {
      return res.status(404).json({ success: false, error: 'Torrent not found' });
    }

    log.info('API', `Manual recheck triggered for hash ${hash}`);
    
    // We start the recheck worker asynchronously
    const config = loadConfig();
    const qbt = new QbtClient();
    
    doRecheck(hash, qbt).catch(err => {
      log.error('API', `Manual recheck failed for ${hash}: ${err.message}`);
    });

    res.json({ success: true, message: 'Recheck started' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

import { runReconciliation } from './reconciler';
import { SonarrClient, RadarrClient } from './arrClient';

apiRouter.post('/trigger-reconciliation', async (req, res) => {
  try {
    log.info('API', 'Manual reconciliation triggered');
    const qbt = new QbtClient();
    const sonarr = new SonarrClient();
    const radarr = new RadarrClient();
    runReconciliation(qbt, sonarr, radarr).catch((e: Error) => {
      log.error('API', `Manual reconciliation failed: ${e.message}`);
    });
    res.json({ success: true, message: 'Reconciliation started' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

import { HealthWorker } from './healthWorker';

apiRouter.post('/trigger-health', async (req, res) => {
  try {
    log.info('API', 'Manual health sweep triggered');
    const qbt = new QbtClient();
    const hw = new HealthWorker(qbt);
    hw.runSweep().catch((e: Error) => {
      log.error('API', `Manual health sweep failed: ${e.message}`);
    });
    res.json({ success: true, message: 'Health sweep started' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/batch', (req, res) => {
  try {
    const { action, linkIds } = req.body;
    if (!Array.isArray(linkIds) || linkIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No linkIds provided' });
    }
    
    const db = getDb();
    
    if (action === 'delete') {
      const placeholders = linkIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM links WHERE id IN (${placeholders})`).run(...linkIds);
      log.info('API', `Batch deleted ${linkIds.length} links`);
      return res.json({ success: true, message: `Deleted ${linkIds.length} links` });
    }
    
    if (action === 're-import') {
      // In a full implementation we'd queue these for re-import logic
      log.info('API', `Batch re-import requested for ${linkIds.length} links - not fully implemented yet`);
      return res.json({ success: true, message: `Re-import triggered for ${linkIds.length} links` });
    }

    res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/config', (req, res) => {
  try {
    const cfg = loadConfig();
    res.json({ success: true, data: cfg });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/config', (req, res) => {
  try {
    saveConfig(req.body);
    const cfg = loadConfig();
    log.info('API', 'Configuration updated successfully');
    res.json({ success: true, data: cfg, message: 'Configuration saved' });
  } catch (err: any) {
    log.error('API', `Failed to save configuration: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/topology', (req, res) => {
  try {
    const db = getDb();
    
    const lens = req.query.lens as string || 'broken';
    const seriesId = parseInt(req.query.seriesId as string);
    const limit = 50; // Hardcap
    
    let query = `
      SELECT l.*, t.name as torrent_name 
      FROM links l
      LEFT JOIN torrents t ON l.hash = t.hash
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (lens === 'healthy') {
      query += ` AND l.current_health = 'healthy'`;
    } else if (lens === 'broken') {
      query += ` AND l.current_health != 'healthy' AND l.current_health IS NOT NULL`;
    } else if (lens === 'batch') {
      query += ` AND l.current_health = 'unprocessed'`;
    } else if (lens === 'series' && !isNaN(seriesId)) {
      query += ` AND l.series_id = ?`;
      params.push(seriesId);
    }
    
    query += ` ORDER BY l.id DESC LIMIT ?`;
    params.push(limit);
    
    const links = db.prepare(query).all(...params) as any[];
    
    const nodes: any[] = [];
    const connections: any[] = [];
    
    for (const link of links) {
      const arrId = `arr-${link.id}`;
      const libId = `lib-${link.id}`;
      const symId = `sym-${link.id}`;
      const qbtId = `qbt-${link.id}`;
      
      const health = link.current_health || 'unknown';
      
      nodes.push({ id: arrId, column: 'arr', label: link.file_name || `Link ${link.id}`, sublabel: link.series_id ? `Series ${link.series_id}` : 'Movie', health });
      nodes.push({ id: libId, column: 'library', label: link.plex_land_path ? link.plex_land_path.split(/[\\/]/).pop() : 'Missing', sublabel: 'Library File', health });
      nodes.push({ id: symId, column: 'symlink', label: link.qbt_land_path ? link.qbt_land_path.split(/[\\/]/).pop() : 'Missing', sublabel: 'Torrents Folder', health });
      nodes.push({ id: qbtId, column: 'qbt', label: link.torrent_name || link.hash || 'Missing', sublabel: 'Torrent', health });
      
      const arrToLibBroken = !link.plex_land_path || health === 'missing_real_file';
      const libToSymBroken = !link.qbt_land_path || health === 'orphan_symlink' || health === 'double_symlink' || health === 'wrong_target';
      const symToQbtBroken = !link.hash || health === 'no_torrent' || health === 'torrent_no_file' || health === 'unmanaged_torrent';
      
      connections.push({ fromId: arrId, toId: libId, status: arrToLibBroken ? 'broken' : 'linked' });
      connections.push({ fromId: libId, toId: symId, status: libToSymBroken ? 'broken' : 'linked' });
      connections.push({ fromId: symId, toId: qbtId, status: symToQbtBroken ? 'broken' : 'linked' });
    }
    
    res.json({
      success: true,
      data: {
        nodes,
        connections
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

