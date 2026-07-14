import express from 'express';
import { log } from './logger';
import { handleImportEvent } from './orchestrator';
import { QbtClient } from './qbtClient';
import { loadConfig } from './config';

export interface ImportEvent {
  source: 'sonarr' | 'radarr';
  isUpgrade: boolean;
  hash: string;
  plexPath: string;
  arrRefs: {
    series_id?: number;
    season_number?: number;
    episode_file_id?: number;
    movie_id?: number;
    movie_file_id?: number;
  };
  deletedFiles?: string[];
}

export const webhookRouter = express.Router();
webhookRouter.use(express.json());

// For orchestrator to listen to
export type ImportEventCallback = (event: ImportEvent) => void;
const listeners: ImportEventCallback[] = [];

export function onImportEvent(callback: ImportEventCallback) {
  listeners.push(callback);
}

function dispatchEvent(event: ImportEvent) {
  for (const listener of listeners) {
    listener(event);
  }
}

export function parseSonarrPayload(payload: any): ImportEvent | null {
  if (payload.eventType === 'Test') {
    log.info('Webhook', 'Received Sonarr Test event');
    return null;
  }

  if (payload.eventType === 'Download') {
    const isUpgrade = payload.isUpgrade === true;
    const hash = payload.downloadId;
    const plexPath = payload.episodeFile?.path;
    
    // We expect season/episode to come from the episodes array (taking the first one for season number)
    const series_id = payload.series?.id;
    const season_number = payload.episodes?.[0]?.seasonNumber;
    const episode_file_id = payload.episodeFile?.id;

    if (!hash || !plexPath) {
      log.warn('Webhook', 'Received Sonarr Download event missing hash or plexPath', { payload });
      return null;
    }

    const deletedFiles = (payload.deletedFiles || []).map((f: any) => f.path);

    return {
      source: 'sonarr',
      isUpgrade,
      hash,
      plexPath,
      arrRefs: {
        series_id,
        season_number,
        episode_file_id
      },
      deletedFiles
    };
  }

  return null;
}

webhookRouter.post('/sonarr', (req, res) => {
  try {
    log.debug('Webhook', 'Received Sonarr payload', req.body);
    if (req.body.eventType === 'Test') {
      log.info('Webhook', 'Received Sonarr Test event');
      return res.status(200).json({ success: true });
    }

    const event = parseSonarrPayload(req.body);
    
    if (!event) {
      log.warn('Webhook', 'Failed to parse Sonarr payload');
      return res.status(400).json({ error: 'Unparseable payload' });
    }

    log.info('Webhook', `Dispatching Sonarr import event for hash ${event.hash}`);
    
    const config = loadConfig();
    const qbt = new QbtClient();
    handleImportEvent(event, qbt).catch((err: any) => {
      log.error('Webhook', `Error handling Sonarr event: ${err.message}`);
    });

    dispatchEvent(event);
    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("SONARR ENDPOINT ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

export function parseRadarrPayload(payload: any): ImportEvent | null {
  if (payload.eventType === 'Test') {
    log.info('Webhook', 'Received Radarr Test event');
    return null;
  }

  if (payload.eventType === 'Download') {
    const isUpgrade = payload.isUpgrade === true;
    const hash = payload.downloadId;
    const plexPath = payload.movieFile?.path;
    
    const movie_id = payload.movie?.id;
    const movie_file_id = payload.movieFile?.id;

    if (!hash || !plexPath) {
      log.warn('Webhook', 'Received Radarr Download event missing hash or plexPath', { payload });
      return null;
    }

    const deletedFiles = (payload.deletedFiles || []).map((f: any) => f.path);

    return {
      source: 'radarr',
      isUpgrade,
      hash,
      plexPath,
      arrRefs: {
        movie_id,
        movie_file_id
      },
      deletedFiles
    };
  }

  return null;
}

webhookRouter.post('/radarr', (req, res) => {
  log.debug('Webhook', 'Received Radarr payload', req.body);
  if (req.body.eventType === 'Test') {
    log.info('Webhook', 'Received Radarr Test event');
    return res.status(200).json({ success: true });
  }

  const event = parseRadarrPayload(req.body);
  
  if (!event) {
    log.warn('Webhook', 'Failed to parse Radarr payload');
    return res.status(400).json({ error: 'Unparseable payload' });
  }

  log.info('Webhook', `Dispatching Radarr import event for hash ${event.hash}`);
  
  const config = loadConfig();
  const qbt = new QbtClient();
  handleImportEvent(event, qbt).catch((err: any) => {
    log.error('Webhook', `Error handling Radarr event: ${err.message}`);
  });

  dispatchEvent(event);
  return res.status(200).json({ success: true });
});
