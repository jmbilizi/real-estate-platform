import { screen } from '@testing-library/react';
import { renderWithClient } from '@/test/renderWithClient';
import { aListingCardRow } from '@/test/fixtures';
import { getListingsByIds } from '@/lib/api/listings';
import { getRecentlyViewedIds } from '@/lib/api/recently-viewed';
import RecentlyViewedPage from './page';

jest.mock('@/lib/api/listings', () => ({
  ...jest.requireActual('@/lib/api/listings'),
  getListingsByIds: jest.fn(),
}));
jest.mock('@/lib/api/recently-viewed', () => ({ getRecentlyViewedIds: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

let mockUser: { email: string } | null = { email: 'a@b.co' };
jest.mock('@/lib/context', () => ({
  useApp: () => ({
    user: mockUser,
    savedHomes: [],
    savedPropertyIds: new Set<string>(),
    toggleSave: jest.fn(),
    isSaved: () => false,
  }),
}));

const mockedIds = getRecentlyViewedIds as jest.Mock;
const mockedByIds = getListingsByIds as jest.Mock;

const card = (id: string, address: string) =>
  aListingCardRow({ id, propertyId: `p-${id}`, address });

describe('RecentlyViewedPage', () => {
  beforeEach(() => {
    mockUser = { email: 'a@b.co' };
    mockedIds.mockReset();
    mockedByIds.mockReset();
  });

  it('has a section for Homes, Services and Connect', async () => {
    mockedIds.mockResolvedValue([]);

    renderWithClient(<RecentlyViewedPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Recently viewed' })).toBeInTheDocument();
    for (const name of ['Homes', 'Services', 'Connect']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(await screen.findByText('No viewed homes yet')).toBeInTheDocument();
    expect(mockedByIds).not.toHaveBeenCalled();
  });

  it('shows the viewed homes, newest first', async () => {
    mockedIds.mockResolvedValue(['L2', 'GONE', 'L1']);
    mockedByIds.mockResolvedValue([card('L2', '2 Newest St'), card('L1', '1 Older St')]);

    renderWithClient(<RecentlyViewedPage />);

    const newest = await screen.findByText(/2 Newest St/);
    const older = await screen.findByText(/1 Older St/);
    expect(mockedByIds.mock.calls[0][0]).toEqual(['L2', 'GONE', 'L1']);
    expect(newest.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a retry when the read fails', async () => {
    mockedIds.mockRejectedValue(new Error('503'));

    renderWithClient(<RecentlyViewedPage />);

    expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in and reads nothing', () => {
    mockUser = null;

    renderWithClient(<RecentlyViewedPage />);

    expect(screen.getByText('Sign in to see the homes you viewed.')).toBeInTheDocument();
    expect(mockedIds).not.toHaveBeenCalled();
  });
});
