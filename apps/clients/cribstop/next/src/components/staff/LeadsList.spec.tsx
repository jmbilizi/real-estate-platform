import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StaffLeadListItem } from '@cribstop/property-contracts';
import LeadsList from './LeadsList';
import * as api from '@/lib/api/staff-leads';

jest.mock('@/lib/api/staff-leads', () => ({
  ...jest.requireActual('@/lib/api/staff-leads'),
  fetchLeads: jest.fn(),
}));
const fetchLeads = api.fetchLeads as jest.Mock;

const item = (n: number, over: Partial<StaffLeadListItem> = {}): StaffLeadListItem => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  kind: 'message',
  status: 'new',
  name: `Buyer ${n}`,
  emailMasked: 'b***@example.com',
  phoneMasked: '***-***-0100',
  verifiedAccount: false,
  listingId: '22222222-2222-4222-8222-222222222222',
  possibleDuplicate: false,
  ...over,
});

beforeEach(() => fetchLeads.mockReset());

it('shows a skeleton, then masked rows with badges', async () => {
  fetchLeads.mockResolvedValue({
    results: [item(1, { possibleDuplicate: true }), item(2, { phoneMasked: null })],
    nextCursor: null,
  });
  render(<LeadsList />);
  expect(screen.getByTestId('leads-skeleton')).toBeInTheDocument();
  expect(await screen.findByText('Buyer 1')).toBeInTheDocument();
  expect(screen.getAllByText('b***@example.com')).toHaveLength(2);
  expect(screen.getByText('***-***-0100')).toBeInTheDocument();
  expect(screen.getByText('No phone')).toBeInTheDocument();
  expect(screen.getAllByText('Possible duplicate')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /Buyer 1/ })).toHaveAttribute(
    'href',
    '/admin/leads/00000000-0000-4000-8000-000000000001',
  );
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

it('shows the contact unavailable, and the lead id link and status, when the lookup failed (#691)', async () => {
  fetchLeads.mockResolvedValue({
    results: [item(1, { name: null, emailMasked: null, verifiedAccount: null })],
    nextCursor: null,
  });
  render(<LeadsList />);
  expect((await screen.findAllByText('Unavailable, retry')).length).toBeGreaterThan(0);
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    '/admin/leads/00000000-0000-4000-8000-000000000001',
  );
  expect(screen.getByRole('link')).toHaveTextContent('New');
});

it('pages with the cursor and appends', async () => {
  fetchLeads
    .mockResolvedValueOnce({ results: [item(1)], nextCursor: 'c1' })
    .mockResolvedValueOnce({ results: [item(2)], nextCursor: null });
  render(<LeadsList />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Buyer 2')).toBeInTheDocument();
  expect(screen.getByText('Buyer 1')).toBeInTheDocument();
  expect(fetchLeads).toHaveBeenLastCalledWith({}, 'c1');
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

it('applies filters and restarts from the first page', async () => {
  fetchLeads.mockResolvedValue({ results: [], nextCursor: null });
  render(<LeadsList />);
  await screen.findByText('No requests match these filters.');
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'spam' } });
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'tour_request' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() =>
    expect(fetchLeads).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'spam', kind: 'tour_request' }),
    ),
  );
});

it('refuses a listing ID that is not a UUID', async () => {
  fetchLeads.mockResolvedValue({ results: [], nextCursor: null });
  render(<LeadsList />);
  await screen.findByText('No requests match these filters.');
  fireEvent.change(screen.getByLabelText('Listing ID'), { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/listing ID/);
  expect(fetchLeads).toHaveBeenCalledTimes(1);
});

it('shows the error and retries', async () => {
  fetchLeads
    .mockRejectedValueOnce(new api.StaffApiError('unavailable', 'Could not reach.'))
    .mockResolvedValueOnce({ results: [item(1)], nextCursor: null });
  render(<LeadsList />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Buyer 1')).toBeInTheDocument();
});
