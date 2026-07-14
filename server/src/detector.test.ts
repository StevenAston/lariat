import { describe, it, expect } from 'vitest';
import { detectFile } from './detector';
import { ResolvedEvent } from './resolver';

describe('Detector', () => {
  const baseEvent = {
    source: 'sonarr',
    isUpgrade: false,
    hash: 'hash123',
    plexPath: 'C:\\Plex\\TV\\Show\\Show S01E01.mkv',
    arrRefs: {},
    torrent: { hash: 'hash123' } as any,
    files: []
  } as ResolvedEvent;

  it('matches exact name and valid size', () => {
    const event = {
      ...baseEvent,
      files: [{ name: 'Show S01E01.mkv', size: 1000 * 1024 * 1024, progress: 1 }]
    };
    
    const enriched = detectFile(event, 1000 * 1024 * 1024);
    expect(enriched).not.toBeNull();
    expect(enriched!.qbtFile.name).toBe('Show S01E01.mkv');
  });

  it('matches case-insensitive name', () => {
    const event = {
      ...baseEvent,
      files: [{ name: 'SHOW s01e01.MKV', size: 1000 * 1024 * 1024, progress: 1 }]
    };
    
    const enriched = detectFile(event, 1000 * 1024 * 1024);
    expect(enriched).not.toBeNull();
    expect(enriched!.qbtFile.name).toBe('SHOW s01e01.MKV');
  });

  it('rejects if delta > 200MB', () => {
    const event = {
      ...baseEvent,
      files: [{ name: 'Show S01E01.mkv', size: 500 * 1024 * 1024, progress: 1 }]
    };
    
    // Plex file is 800MB, qbt file is 500MB -> 300MB delta
    const enriched = detectFile(event, 800 * 1024 * 1024);
    expect(enriched).toBeNull();
  });

  it('rejects sample files (<100MB and contains sample)', () => {
    const event = {
      ...baseEvent,
      plexPath: 'C:\\Plex\\TV\\Show\\sample.mkv',
      files: [{ name: 'sample.mkv', size: 50 * 1024 * 1024, progress: 1 }]
    };
    
    const enriched = detectFile(event, 50 * 1024 * 1024);
    expect(enriched).toBeNull();
  });

  it('allows files <100MB if not named sample', () => {
    const event = {
      ...baseEvent,
      plexPath: 'C:\\Plex\\TV\\Show\\episode.mkv',
      files: [{ name: 'episode.mkv', size: 50 * 1024 * 1024, progress: 1 }]
    };
    
    const enriched = detectFile(event, 50 * 1024 * 1024);
    expect(enriched).not.toBeNull();
  });
});
