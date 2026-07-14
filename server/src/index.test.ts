import request from 'supertest';
import { describe, it, expect } from 'vitest';
import app from './index';

describe('Server boot', () => {
  it('GET /api/ping should return 200 with version', async () => {
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: '1.0.0' });
  });
});
