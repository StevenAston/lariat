import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildQbtPathMap } from './qbtPathMap';
import { QbtClient } from './qbtClient';
import { normalisePath } from './config';

describe('QBT Path Map Builder', () => {
  let mockQbt: Partial<QbtClient>;

  beforeEach(() => {
    mockQbt = {
      torrentsInfo: vi.fn().mockResolvedValue([
        { hash: 'hash1', save_path: 'C:\\Downloads\\tv', name: 'Show1' },
        { hash: 'hash2', save_path: 'C:\\Downloads\\movies', name: 'Movie1' }
      ]),
      torrentFiles: vi.fn().mockImplementation(async (hash: string) => {
        if (hash === 'hash1') {
          return [
            { name: 'Show1\\S01E01.mkv', size: 100, progress: 1 },
            { name: 'Show1\\S01E02.mkv', size: 100, progress: 1 }
          ];
        } else if (hash === 'hash2') {
          return [
            { name: 'Movie1.mkv', size: 1000, progress: 1 }
          ];
        }
        return [];
      })
    };
  });

  it('builds a map with O(1) lookups and uses normalisePath', async () => {
    const map = await buildQbtPathMap(mockQbt as QbtClient);
    
    expect(map.size).toBe(3);

    // Look up with case/slash variations using normalisePath
    const path1 = normalisePath('c:/downloads/tv/show1/s01e01.mkv');
    const entry1 = map.get(path1);
    expect(entry1).toBeDefined();
    expect(entry1?.hash).toBe('hash1');
    expect(entry1?.file.name).toBe('Show1\\S01E01.mkv');

    const path2 = normalisePath('C:\\Downloads\\movies\\Movie1.mkv');
    const entry2 = map.get(path2);
    expect(entry2).toBeDefined();
    expect(entry2?.hash).toBe('hash2');
    
    const missing = map.get(normalisePath('C:\\Downloads\\unknown.mkv'));
    expect(missing).toBeUndefined();
  });
});
