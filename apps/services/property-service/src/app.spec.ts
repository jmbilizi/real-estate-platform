import request from 'supertest';
import { createApp } from './app';

describe('GET /health', () => {
  it('responds 200 with a status ok payload', async () => {
    const app = createApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
