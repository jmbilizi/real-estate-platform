import AdminLayout, { metadata } from './layout';
import { loadStaffGate } from '@/lib/api/staff-server';
import { notFound, redirect } from 'next/navigation';

jest.mock('@/lib/api/staff-server', () => ({ loadStaffGate: jest.fn() }));
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: jest.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

const gate = loadStaffGate as jest.Mock;

beforeEach(() => {
  gate.mockReset();
  (notFound as unknown as jest.Mock).mockClear();
  (redirect as unknown as jest.Mock).mockClear();
});

it('is noindex', () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});

it.each(['Admin', 'SuperAdmin', 'Moderator'])('renders for %s', async (role) => {
  gate.mockResolvedValue({ roles: ['User', role], canRefresh: false });
  await expect(AdminLayout({ children: 'inside' })).resolves.toBeTruthy();
  expect(notFound).not.toHaveBeenCalled();
});

it.each([[[]], [['User']], [['Agent', 'Provider']]])('returns 404 for roles %j', async (roles) => {
  gate.mockResolvedValue({ roles, canRefresh: false });
  await expect(AdminLayout({ children: 'inside' })).rejects.toThrow('NEXT_NOT_FOUND');
  expect(notFound).toHaveBeenCalled();
});

it('sends an expired session through the refresh route once', async () => {
  gate.mockResolvedValue({ roles: [], canRefresh: true });
  await expect(AdminLayout({ children: 'inside' })).rejects.toThrow('NEXT_REDIRECT');
  expect(redirect).toHaveBeenCalledWith('/api/staff/refresh');
});
