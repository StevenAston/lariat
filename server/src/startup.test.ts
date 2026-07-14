import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rearmCoordinators } from './startup';
import { getDb, initDb } from './db';
import { QbtClient } from './qbtClient';
import { getState, clearAll, debounceRecheck, setRecheckCallback } from './coordinator';

describe('Startup Integration', () => {
  let mockQbt: Partial<QbtClient>;

  beforeEach(() => {
    initDb(':memory:');
    const db = getDb();
    
    // Create torrent
    db.prepare(`
      INSERT INTO torrents (hash, name, save_path, state) 
      VALUES ('hash_pack', 'Season 1', 'C:\\downloads', 'downloading')
    `).run();

    // Insert 5 links (half imported pack)
    const insertLink = db.prepare(`
      INSERT INTO links (hash, episode_file_id) VALUES ('hash_pack', ?)
    `);
    for (let i = 1; i <= 5; i++) {
      insertLink.run(i);
    }

    // Mock QBT with 10 video files
    mockQbt = {
      torrentFiles: vi.fn().mockResolvedValue(
        Array.from({ length: 10 }).map((_, i) => ({ name: `S01E${i + 1}.mkv`, size: 100 }))
      )
    };
    
    clearAll();
  });

  afterEach(() => {
    clearAll();
    setRecheckCallback(() => {});
  });

  it('re-arms coordinator for a half-imported pack', async () => {
    await rearmCoordinators(mockQbt as QbtClient);

    const state = getState('hash_pack');
    expect(state).not.toBeNull();
    expect(state?.videoFileCount).toBe(10);
    expect(state?.importsSeen).toBe(5);

    // Now, if we simulate 5 more imports, it should fire EXACTLY ONCE
    let fireCount = 0;
    setRecheckCallback((hash) => {
      if (hash === 'hash_pack') fireCount++;
    });

    for (let i = 6; i <= 10; i++) {
      debounceRecheck('hash_pack', i.toString(), 10, 5000);
    }

    // It should have fired synchronously on the 10th import (C1 met)
    expect(fireCount).toBe(1);
    
    // Verify it doesn't fire again
    debounceRecheck('hash_pack', '11', 10, 5000); // extra import?
    expect(fireCount).toBe(1);
  });
});
