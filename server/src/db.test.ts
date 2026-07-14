import { describe, it, expect } from 'vitest';
import { initDb, runMigrations } from './db';

describe('Database', () => {
  it('runs migrations and allows inserting and reading data with FKs', () => {
    // In-memory database
    const db = initDb(':memory:');

    // Insert torrent
    db.prepare('INSERT INTO torrents (hash, name, save_path) VALUES (?, ?, ?)')
      .run('deadbeef1234', 'Some.Show.S01', 'X:/Torrents/Some.Show.S01');

    // Insert link
    const insertLink = db.prepare('INSERT INTO links (hash, file_name, qbt_land_path, swap_status) VALUES (?, ?, ?, ?)');
    const linkInfo = insertLink.run('deadbeef1234', 'episode1.mkv', 'X:/Torrents/Some.Show.S01/episode1.mkv', 'linked');
    
    // Insert event
    const insertEvent = db.prepare('INSERT INTO events (link_id, torrent_hash, type, message) VALUES (?, ?, ?, ?)');
    insertEvent.run(linkInfo.lastInsertRowid, 'deadbeef1234', 'swap', 'Successfully swapped file');

    // Read back
    const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkInfo.lastInsertRowid) as any;
    expect(link.hash).toBe('deadbeef1234');
    expect(link.file_name).toBe('episode1.mkv');
    expect(link.swap_status).toBe('linked');

    const event = db.prepare('SELECT * FROM events WHERE link_id = ?').get(linkInfo.lastInsertRowid) as any;
    expect(event.type).toBe('swap');
    expect(event.torrent_hash).toBe('deadbeef1234');

    // Verify foreign key constraint (deleting torrent should delete link and event due to ON DELETE CASCADE)
    db.prepare('DELETE FROM torrents WHERE hash = ?').run('deadbeef1234');

    const deletedLink = db.prepare('SELECT * FROM links WHERE id = ?').get(linkInfo.lastInsertRowid);
    expect(deletedLink).toBeUndefined();

    const deletedEvent = db.prepare('SELECT * FROM events WHERE link_id = ?').get(linkInfo.lastInsertRowid);
    expect(deletedEvent).toBeUndefined();
  });

  it('is idempotent when migrations are run twice', () => {
    const db = initDb(':memory:');
    
    // Migrations have run once. Let's run them again manually.
    const version = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as any;
    const initialVersion = version.v;
    
    runMigrations(db);
    
    const versionAfter = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as any;
    expect(versionAfter.v).toBe(initialVersion);
  });
});
