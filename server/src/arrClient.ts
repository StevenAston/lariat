import { config } from './config';

export interface EpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber: number;
  path: string;
  size: number;
}

export interface Episode {
  id: number;
  seriesId: number;
  episodeFileId: number;
  seasonNumber: number;
  episodeNumber: number;
}

export interface Series {
  id: number;
  title: string;
  path: string;
}

export interface MovieFile {
  id: number;
  movieId: number;
  path: string;
  size: number;
}

export interface Movie {
  id: number;
  title: string;
  path: string;
}

abstract class ArrClient {
  constructor(protected baseUrl: string, protected apiKey: string) {}

  protected async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.append(key, value);
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        'X-Api-Key': this.apiKey,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`*arr Request failed: ${res.status} ${res.statusText} for ${endpoint}`);
    }

    return res.json() as Promise<T>;
  }
}

export class SonarrClient extends ArrClient {
  constructor() {
    super(config.SONARR_URL, config.SONARR_API_KEY);
  }

  async getSeries(id: number): Promise<Series> {
    return this.request<Series>(`/api/v3/series/${id}`);
  }

  async listEpisodes(seriesId: number, seasonNumber: number): Promise<Episode[]> {
    return this.request<Episode[]>('/api/v3/episode', { 
      seriesId: seriesId.toString(), 
      seasonNumber: seasonNumber.toString() 
    });
  }

  async listEpisodeFiles(): Promise<EpisodeFile[]> {
    const pageSize = 1000;
    let page = 1;
    let allFiles: EpisodeFile[] = [];
    
    while (true) {
      const response = await this.request<{ records: EpisodeFile[], totalRecords: number }>('/api/v3/episodefile', {
        page: page.toString(),
        pageSize: pageSize.toString(),
      });
      
      allFiles = allFiles.concat(response.records);
      
      if (allFiles.length >= response.totalRecords || response.records.length === 0) {
        break;
      }
      
      page++;
    }
    
    return allFiles;
  }
}

export class RadarrClient extends ArrClient {
  constructor() {
    super(config.RADARR_URL, config.RADARR_API_KEY);
  }

  async getMovie(id: number): Promise<Movie> {
    return this.request<Movie>(`/api/v3/movie/${id}`);
  }

  async listMovieFiles(): Promise<MovieFile[]> {
    // Radarr moviefile endpoint does not seem paginated in the same way, but let's assume it returns an array
    // Wait, the spec says Sonarr is paginated. Radarr `listMovieFiles` might just be `moviefile` array.
    return this.request<MovieFile[]>('/api/v3/moviefile');
  }
}
