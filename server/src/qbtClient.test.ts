import { describe, it, expect, beforeEach, afterEach, vi, MockInstance } from 'vitest';
import { QbtClient } from './qbtClient';

describe('QbtClient', () => {
  let fetchSpy: MockInstance<any>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('torrentsByHash returns parsed torrent for known hash and null for unknown', async () => {
    const client = new QbtClient();

    // Mock fetch for auth and then for data
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      
      if (url.includes('/api/v2/auth/login')) {
        return new Response('Ok.', { status: 200, headers: { 'set-cookie': 'SID=12345; path=/' } });
      }

      if (url.includes('/api/v2/torrents/info?hashes=')) {
        if (url.includes('knownhash')) {
          return new Response(JSON.stringify([{ hash: 'knownhash', name: 'Some.Show' }]), { 
            status: 200, 
            headers: { 'content-type': 'application/json' } 
          });
        }
        // Unknown hash returns empty array
        return new Response(JSON.stringify([]), { 
          status: 200, 
          headers: { 'content-type': 'application/json' } 
        });
      }

      return new Response('Not found', { status: 404 });
    });

    const known = await client.torrentsByHash('knownhash');
    expect(known).toEqual({ hash: 'knownhash', name: 'Some.Show' });

    const unknown = await client.torrentsByHash('missinghash');
    expect(unknown).toBeNull();
  });

  it('403 on data call triggers exactly one re-auth then retry', async () => {
    const client = new QbtClient();

    let authCalls = 0;
    let dataCalls = 0;

    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      
      if (url.includes('/api/v2/auth/login')) {
        authCalls++;
        return new Response('Ok.', { status: 200, headers: { 'set-cookie': `SID=NEW${authCalls}; path=/` } });
      }

      if (url.includes('/api/v2/torrents/info')) {
        dataCalls++;
        
        // Fail on first data call (which implies auth was either missing or invalid)
        // Wait, if it's the very first request, the client authenticates automatically.
        // Let's say the cookie is accepted but the server rejects it.
        // Actually, the client will call auth() if it doesn't have a cookie.
        // So the first request to `request()` will call auth.
        // Then it will make the data call. We want to simulate that data call returning 403.
        
        if (dataCalls === 1) {
          return new Response('Forbidden', { status: 403 });
        }
        
        // On second data call (retry), succeed
        return new Response(JSON.stringify([{ hash: 'testhash' }]), { 
          status: 200, 
          headers: { 'content-type': 'application/json' } 
        });
      }

      return new Response('Not found', { status: 404 });
    });

    const result = await client.torrentsByHash('testhash');
    
    // Auth should be called twice: once initially (because no cookie), once on 403 retry.
    expect(authCalls).toBe(2);
    // Data should be called twice: once fails, once succeeds.
    expect(dataCalls).toBe(2);
    
    expect(result).toEqual({ hash: 'testhash' });
  });
});
