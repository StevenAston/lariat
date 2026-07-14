import { describe, it, expect, beforeEach, afterEach, vi, MockInstance } from 'vitest';
import { SonarrClient, RadarrClient } from './arrClient';

describe('ArrClients', () => {
  let fetchSpy: MockInstance<any>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SonarrClient', () => {
    it('listEpisodeFiles correctly assembles a multi-page result into a single array', async () => {
      const client = new SonarrClient();

      fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
        const url = input.toString();
        
        if (url.includes('/api/v3/episodefile?page=1')) {
          return new Response(JSON.stringify({
            records: [{ id: 1, path: '/file1.mkv' }],
            totalRecords: 2
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        if (url.includes('/api/v3/episodefile?page=2')) {
          return new Response(JSON.stringify({
            records: [{ id: 2, path: '/file2.mkv' }],
            totalRecords: 2
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        return new Response('Not found', { status: 404 });
      });

      const files = await client.listEpisodeFiles();
      expect(files).toHaveLength(2);
      expect(files[0].id).toBe(1);
      expect(files[1].id).toBe(2);
    });

    it('getSeries and listEpisodes return expected shape', async () => {
      const client = new SonarrClient();

      fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
        const url = input.toString();
        
        if (url.includes('/api/v3/series/10')) {
          return new Response(JSON.stringify({ id: 10, title: 'Show', path: '/Show' }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        if (url.includes('/api/v3/episode?seriesId=10&seasonNumber=1')) {
          return new Response(JSON.stringify([{ id: 100, seriesId: 10, seasonNumber: 1, episodeNumber: 1 }]), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        return new Response('Not found', { status: 404 });
      });

      const series = await client.getSeries(10);
      expect(series).toEqual({ id: 10, title: 'Show', path: '/Show' });

      const episodes = await client.listEpisodes(10, 1);
      expect(episodes).toHaveLength(1);
      expect(episodes[0].id).toBe(100);
    });
  });

  describe('RadarrClient', () => {
    it('returns expected shapes', async () => {
      const client = new RadarrClient();

      fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
        const url = input.toString();
        
        if (url.includes('/api/v3/movie/20')) {
          return new Response(JSON.stringify({ id: 20, title: 'Movie', path: '/Movie' }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        if (url.includes('/api/v3/moviefile')) {
          return new Response(JSON.stringify([{ id: 200, movieId: 20, path: '/Movie/movie.mkv' }]), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        return new Response('Not found', { status: 404 });
      });

      const movie = await client.getMovie(20);
      expect(movie).toEqual({ id: 20, title: 'Movie', path: '/Movie' });

      const files = await client.listMovieFiles();
      expect(files).toHaveLength(1);
      expect(files[0].id).toBe(200);
    });
  });
});
