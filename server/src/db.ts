import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function initDb(dbPath: string): Database.Database {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const migrations = [
  // 001 - Initial schema
  `
  CREATE TABLE IF NOT EXISTS torrents (
    hash TEXT PRIMARY KEY,
    name TEXT,
    save_path TEXT,
    category TEXT,
    tags TEXT,
    size INTEGER,
    added_on INTEGER,
    completion_on INTEGER,
    state TEXT
  );

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT REFERENCES torrents(hash) ON DELETE CASCADE,
    file_name TEXT,
    file_size INTEGER,
    qbt_land_path TEXT,
    plex_land_path TEXT,
    series_id INTEGER,
    season_number INTEGER,
    episode_file_id INTEGER,
    movie_id INTEGER,
    movie_file_id INTEGER,
    swap_status TEXT,
    swap_mode TEXT,
    current_health TEXT,
    last_health_check_id INTEGER,
    integrity_root TEXT,
    integrity_size INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER REFERENCES links(id) ON DELETE CASCADE,
    torrent_hash TEXT REFERENCES torrents(hash) ON DELETE CASCADE,
    type TEXT,
    message TEXT,
    detail TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS health_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER REFERENCES links(id) ON DELETE CASCADE,
    status TEXT,
    detail TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS file_hashes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER REFERENCES links(id) ON DELETE CASCADE,
    offset INTEGER,
    hash TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER DEFAULT (unixepoch())
  );
  `,
  // 002 - Add integrity columns
  `
  ALTER TABLE links ADD COLUMN integrity_root TEXT;
  ALTER TABLE links ADD COLUMN integrity_size INTEGER;
  `
];

export function runMigrations(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER DEFAULT (unixepoch())
    );
  `);

  const row = database.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as { version: number | null };
  const currentVersion = row?.version ?? 0;

  for (let i = currentVersion; i < migrations.length; i++) {
    const runMigration = database.transaction(() => {
      try {
        database.exec(migrations[i]);
      } catch (err: any) {
        if (!err.message.includes('duplicate column name')) {
          throw err;
        }
      }
      database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(i + 1);
    });
    runMigration();
  }
}

export function saveLinkIntegrity(linkId: number, data: { root: string; sizeAtHash: number; leaves: { offset: number; hash: string }[] }) {
  const db = getDb();
  const tx = db.transaction(() => {
    // Update link
    db.prepare(`UPDATE links SET integrity_root = ?, integrity_size = ? WHERE id = ?`)
      .run(data.root, data.sizeAtHash, linkId);
    
    // Clear old leaves
    db.prepare(`DELETE FROM file_hashes WHERE link_id = ?`).run(linkId);
    
    // Insert new leaves
    const stmt = db.prepare(`INSERT INTO file_hashes (link_id, offset, hash) VALUES (?, ?, ?)`);
    for (const leaf of data.leaves) {
      stmt.run(linkId, leaf.offset, leaf.hash);
    }
  });
  tx();
}

export function getStoredHashes(linkId: number): { root: string | null; sizeAtHash: number | null; leaves: { offset: number; hash: string }[] } {
  const db = getDb();
  const link = db.prepare(`SELECT integrity_root, integrity_size FROM links WHERE id = ?`).get(linkId) as any;
  if (!link) return { root: null, sizeAtHash: null, leaves: [] };

  const leaves = db.prepare(`SELECT offset, hash FROM file_hashes WHERE link_id = ? ORDER BY offset ASC`).all(linkId) as any[];
  
  return {
    root: link.integrity_root,
    sizeAtHash: link.integrity_size,
    leaves
  };
}
