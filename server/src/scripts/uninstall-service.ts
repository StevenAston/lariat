import { Service } from 'node-windows';
import path from 'path';

// Note: This script is intended to be run from the compiled dist/scripts folder
const svc = new Service({
  name: 'Lariat',
  description: 'Lariat - Symlink manager for Sonarr/Radarr and qBittorrent',
  script: path.join(__dirname, '../index.js')
});

svc.on('uninstall', () => {
  console.log('Lariat service uninstalled successfully.');
});

console.log('Uninstalling Lariat service...');
svc.uninstall();
