import { Service } from 'node-windows';
import path from 'path';

// Note: This script is intended to be run from the compiled dist/scripts folder
const svc = new Service({
  name: 'Lariat',
  description: 'Lariat - Symlink manager for Sonarr/Radarr and qBittorrent',
  script: path.join(__dirname, '../index.js'),
  env: [{
    name: "NODE_ENV",
    value: "production"
  }]
});

svc.on('install', () => {
  console.log('Lariat service installed successfully.');
  console.log('Starting service...');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('Lariat service is already installed.');
});

svc.on('start', () => {
  console.log('Lariat service started.');
});

console.log('Installing Lariat service...');
svc.install();
