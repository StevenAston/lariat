import { config } from './config';
import { log } from './logger';

export interface TorrentInfo {
  hash: string;
  name: string;
  save_path: string;
  category: string;
  tags: string;
  size: number;
  added_on: number;
  completion_on: number;
  state: string;
}

export interface TorrentFile {
  name: string;
  size: number;
  progress: number;
}

export class QbtClient {
  private baseUrl: string;
  private cookie: string | null = null;

  constructor() {
    const proto = config.QBT_HOST.startsWith('http') ? '' : 'http://';
    this.baseUrl = `${proto}${config.QBT_HOST}:${config.QBT_PORT}`;
  }

  private async authenticate(): Promise<void> {
    if (config.QBT_API_KEY) {
      return; // Stateless authentication
    }

    log.debug('QbtClient', 'Authenticating...');
    const params = new URLSearchParams();
    params.append('username', config.QBT_USER || '');
    params.append('password', config.QBT_PASS || '');

    const res = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      body: params,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': this.baseUrl,
      }
    });

    if (!res.ok) {
      throw new Error(`QBT Auth failed: ${res.status} ${res.statusText}`);
    }

    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) {
      throw new Error('QBT Auth failed: No cookie returned');
    }

    this.cookie = setCookie.split(';')[0];
    log.debug('QbtClient', 'Authenticated successfully');
  }

  private async request<T>(endpoint: string, method: string = 'GET', body?: any, retryOn403: boolean = true): Promise<T> {
    if (!config.QBT_API_KEY && !this.cookie) {
      await this.authenticate();
    }

    const headers: Record<string, string> = {
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
    };

    if (config.QBT_API_KEY) {
      headers['Authorization'] = `Bearer ${config.QBT_API_KEY}`;
    } else if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      body: body ? new URLSearchParams(body) : undefined,
      headers
    });

    if (res.status === 403 && retryOn403) {
      log.debug('QbtClient', 'Got 403, re-authenticating and retrying');
      this.cookie = null;
      await this.authenticate();
      return this.request<T>(endpoint, method, body, false);
    }

    if (!res.ok) {
      throw new Error(`QBT Request failed: ${res.status} ${res.statusText}`);
    }

    if (res.headers.get('content-type')?.includes('application/json')) {
      return res.json() as Promise<T>;
    }
    
    return res.text() as unknown as Promise<T>;
  }

  async torrentsInfo(): Promise<TorrentInfo[]> {
    return this.request<TorrentInfo[]>('/api/v2/torrents/info');
  }

  async torrentsByHash(hash: string): Promise<TorrentInfo | null> {
    const list = await this.request<TorrentInfo[]>(`/api/v2/torrents/info?hashes=${hash}`);
    return list.length > 0 ? list[0] : null;
  }

  async torrentFiles(hash: string): Promise<TorrentFile[]> {
    return this.request<TorrentFile[]>(`/api/v2/torrents/files?hash=${hash}`);
  }

  async pause(hash: string): Promise<void> {
    await this.request<void>('/api/v2/torrents/pause', 'POST', { hashes: hash });
  }

  async resume(hash: string): Promise<void> {
    await this.request<void>('/api/v2/torrents/resume', 'POST', { hashes: hash });
  }

  async recheck(hash: string): Promise<void> {
    await this.request<void>('/api/v2/torrents/recheck', 'POST', { hashes: hash });
  }
}
