/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from './route';
import { tryRefreshToken } from '@/app/api/_lib/refresh';

jest.mock('@/app/api/_lib/refresh', () => ({ tryRefreshToken: jest.fn() }));

it('refreshes, redirects to the lead list and sets the one-shot cookie', async () => {
  (tryRefreshToken as jest.Mock).mockResolvedValue('new');
  const res = await GET(new NextRequest('http://localhost/api/staff/refresh'));
  expect(res.status).toBe(307);
  expect(res.headers.get('location')).toBe('http://localhost/admin/leads');
  expect(res.cookies.get('staff_refresh_try')?.value).toBe('1');
});
