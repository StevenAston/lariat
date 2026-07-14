import express from 'express';
import path from 'path';
import { checkSystemHealth, getCachedHealth } from './health';
import { runStartupIntegration } from './startup';
import { loadConfig } from './config';
import { initDb } from './db';
import { QbtClient } from './qbtClient';
import fs from 'fs';
import { SonarrClient, RadarrClient } from './arrClient';
import { webhookRouter } from './webhooks';
import { apiRouter } from './api';
import { setupWebSocket } from './ws';

export function createServer() {
  const app = express();
  
  app.use(express.json());
  
  app.use('/webhook', webhookRouter);
  app.use('/api', apiRouter);
  
  app.get('/api/ping', (req, res) => {
    res.status(200).json({ ok: true, version: '1.0.0' });
  });

  // Serve static client files in production
  const clientDistPath = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDistPath));

  // SPA Fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });

  app.get('/api/health/system', async (req, res) => {
    const health = await checkSystemHealth();
    res.status(200).json(health);
  });
  
  return app;
}

const app = createServer();
const port = process.env.PORT || 3001;

if (require.main === module) {
  const server = app.listen(port, async () => {
    console.log(`Lariat server listening on port ${port}`);
    
    // Setup WebSocket Live Log
    setupWebSocket(server);

    // Initialize Database
    const dbDir = path.resolve(__dirname, '../../data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    initDb(path.join(dbDir, 'lariat.db'));

    await checkSystemHealth();
    
    // Run phase 2 startup tasks
    try {
      const config = loadConfig();
      const qbt = new QbtClient();
      const sonarr = new SonarrClient();
      const radarr = new RadarrClient();
      await runStartupIntegration(qbt, sonarr, radarr);
    } catch (e: any) {
      console.error('Failed to run startup integration:', e.message);
    }
  });
}

export default app;
