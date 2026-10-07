import AdminLayout, { metadata } from './layout';
import { loadStaffRoles } from '@/lib/api/staff-server';
import { notFound } from 'next/navigation';

jest.mock('@/lib/api/staff-server', () => ({ loadStaffRoles: jest.fn() }));
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const roles = loadStaffRoles as jest.Mock;

beforeEach(() => {
  roles.mockReset();
  (notFound as unknown as jest.Mock).mockClear();
});

it('is noindex', () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});

it.each(['Admin', 'SuperAdmin', 'Moderator'])('renders for %s', async (role) => {
  roles.mockResolvedValue(['User', role]);
  await expect(AdminLayout({ children: 'inside' })).resolves.toBeTruthy();
  expect(notFound).not.toHaveBeenCalled();
});

it.each([[[]], [['User']], [['Agent', 'Provider']]])('returns 404 for roles %j', async (r) => {
  roles.mockResolvedValue(r);
  await expect(AdminLayout({ children: 'inside' })).rejects.toThrow('NEXT_NOT_FOUND');
  expect(notFound).toHaveBeenCalled();
});
