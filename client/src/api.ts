export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  ping: () => fetchJson<{ ok: boolean; version: string }>('/api/ping'),
  getLinks: (params?: { page?: number; limit?: number; sortBy?: string; sortDesc?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', params.page.toString());
    if (params?.limit) qs.set('limit', params.limit.toString());
    if (params?.sortBy) qs.set('sortBy', params.sortBy);
    if (params?.sortDesc) qs.set('sortDesc', 'true');
    const query = qs.toString();
    return fetchJson<{
      success: boolean;
      data: {
        links: any[];
        pagination: { page: number; limit: number; total: number; totalPages: number; };
      }
    }>(`/api/links${query ? '?' + query : ''}`);
  },
  getLink: (id: string) => fetchJson<{
    success: boolean;
    data: {
      link: any;
      healthCheck: any;
      events: any[];
    };
  }>(`/api/links/${id}`),
  triggerRecheck: (hash: string) => fetch(`/api/recheck/${hash}`, { method: 'POST' }).then(r => r.json()),
  triggerReconciliation: () => fetch('/api/trigger-reconciliation', { method: 'POST' }).then(r => r.json()),
  triggerHealthSweep: () => fetch('/api/trigger-health', { method: 'POST' }).then(r => r.json()),
  batchAction: (action: 'delete' | 're-import', linkIds: number[]) => fetch('/api/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, linkIds })
  }).then(r => r.json()),
  getConfig: () => fetchJson<{ success: boolean; data: any }>('/api/config'),
  saveConfig: (data: any) => fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),
  getSummary: () => fetchJson<{
    success: boolean;
    data: {
      totals: { torrents: number; links: number; };
      byAnomaly: Record<string, number>;
      lastReconciliation: string | null;
      lastHealthSweep: string | null;
      recheckQueueDepth: number;
    }
  }>('/api/summary'),
  getSystemHealth: () => fetchJson<any>('/api/health/system'),
  getTopology: (lens: string) => fetchJson<any>(`/api/topology?lens=${lens}`)
};
