import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveTorrent } from './resolver';
import { QbtClient } from './qbtClient';
import { ImportEvent } from './webhooks';
import { addLogListener } from './logger';

describe('Resolver', () => {
  let mockQbt: QbtClient;

  beforeEach(() => {
    mockQbt = {
      torrentsByHash: vi.fn(),
      torrentFiles: vi.fn()
    } as unknown as QbtClient;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('yields ResolvedEvent if QBT returns torrent and files', async () => {
    vi.mocked(mockQbt.torrentsByHash).mockResolvedValue({ hash: 'hash123', state: 'downloading' } as any);
    vi.mocked(mockQbt.torrentFiles).mockResolvedValue([{ name: 'file.mkv' }] as any);

    const event: ImportEvent = {
      source: 'sonarr',
      isUpgrade: false,
      hash: 'hash123',
      plexPath: '/plex/path.mkv',
      arrRefs: {}
    };

    const resolved = await resolveTorrent(event, mockQbt);
    
    expect(resolved).not.toBeNull();
    expect(resolved!.torrent.hash).toBe('hash123');
    expect(resolved!.files[0].name).toBe('file.mkv');
  });

  it('returns null and logs warning if hash not found in QBT', async () => {
    vi.mocked(mockQbt.torrentsByHash).mockResolvedValue(null);

    const event: ImportEvent = {
      source: 'sonarr',
      isUpgrade: false,
      hash: 'missing',
      plexPath: '/plex/path.mkv',
      arrRefs: {}
    };

    const logSpy = vi.fn();
    addLogListener(logSpy);

    const resolved = await resolveTorrent(event, mockQbt);
    
    expect(resolved).toBeNull();
    expect(logSpy).toHaveBeenCalledWith('warn', 'Resolver', 'Hash not found in QBT', { hash: 'missing' });
  });

  it('returns null if torrent is in error state', async () => {
    vi.mocked(mockQbt.torrentsByHash).mockResolvedValue({ hash: 'hash123', state: 'error' } as any);

    const event: ImportEvent = {
      source: 'sonarr',
      isUpgrade: false,
      hash: 'hash123',
      plexPath: '/plex/path.mkv',
      arrRefs: {}
    };

    const resolved = await resolveTorrent(event, mockQbt);
    expect(resolved).toBeNull();
  });
});
