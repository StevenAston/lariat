import fs from 'fs';
import path from 'path';
import { getDb, initDb } from '../db';
import { QbtClient } from '../qbtClient';
import { doSwap } from '../swapWorker';
import { doRecheck } from '../recheckWorker';
import { loadConfig } from '../config';
import { log } from '../logger';

async function run() {
  const hash = process.argv[2];
  const plexPath = process.argv[3];

  if (!hash || !plexPath) {
    console.error('Usage: npx tsx move-harness.ts <hash> <plex_destination_path>');
    process.exit(1);
  }

  console.log(`Starting Move Mode Harness for hash: ${hash}`);
  
  // Load config & initialize QbtClient
  loadConfig();
  const db = initDb(':memory:');
  const qbt = new QbtClient();

  // 1. Fetch Torrent
  const torrent = await qbt.torrentsByHash(hash);
  if (!torrent) {
    console.error(`Torrent ${hash} not found in QBT.`);
    process.exit(1);
  }
  
  const files = await qbt.torrentFiles(hash);
  if (files.length === 0) {
    console.error(`Torrent ${hash} has no files.`);
    process.exit(1);
  }
  
  const targetFile = files[0];
  const qbtPath = path.join(torrent.save_path, targetFile.name);
  console.log(`Identified QBT path: ${qbtPath}`);

  // 2. Ensure QBT file exists (pre-move)
  if (!fs.existsSync(qbtPath)) {
    console.error(`File does not exist at QBT path: ${qbtPath}`);
    process.exit(1);
  }

  // 3. Simulate Sonarr Move
  console.log(`Simulating Sonarr moving the file to ${plexPath}...`);
  fs.mkdirSync(path.dirname(plexPath), { recursive: true });
  fs.renameSync(qbtPath, plexPath); // The actual move

  // 4. Setup DB
  db.prepare('INSERT OR IGNORE INTO torrents (hash, name, save_path) VALUES (?, ?, ?)').run(hash, torrent.name, torrent.save_path);
  const info = db.prepare(`
    INSERT INTO links (hash, file_name, file_size, qbt_land_path, plex_land_path, swap_status, swap_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(hash, targetFile.name, targetFile.size, qbtPath, plexPath, 'pending', 'move');
  const linkId = info.lastInsertRowid as number;

  // 5. Run Move Swap
  console.log('Executing Move-mode swap...');
  try {
    await doSwap(linkId, 'move', qbt);
    console.log('Swap successful! Verifying recheck...');
    
    // 6. Run Recheck
    await doRecheck(hash, qbt);
    console.log('Recheck passed! The torrent should now be seeding via the symlink.');
    console.log('Move-mode test harness completed successfully.');
  } catch (err: any) {
    console.error(`Swap or Recheck failed: ${err.message}`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
