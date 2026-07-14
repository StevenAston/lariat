import { getDb } from './db';

// This is a stub for the repositories module. As workers are built, 
// specific queries will be added here.

export const torrentsRepo = {
  upsert(hash: string, data: any) {
    // Basic upsert logic (will be expanded)
  },
  getByHash(hash: string) {
    return getDb().prepare('SELECT * FROM torrents WHERE hash = ?').get(hash);
  }
};

export const linksRepo = {
  insert(data: any) {
    // Basic insert
  },
  getById(id: number) {
    return getDb().prepare('SELECT * FROM links WHERE id = ?').get(id);
  }
};
