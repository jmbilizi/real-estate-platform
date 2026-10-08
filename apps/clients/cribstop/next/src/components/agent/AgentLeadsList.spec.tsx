import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AgentLeadListItem } from '@cribstop/property-contracts';
import AgentLeadsList from './AgentLeadsList';
import * as api from '@/lib/api/agent-leads';
import { StaffApiError } from '@/lib/api/staff-leads';

jest.mock('@/lib/api/agent-leads', () => ({
  fetchAgentLeads: jest.fn(),
  acceptLead: jest.fn(),
  declineLead: jest.fn(),
}));
const fetchAgentLeads = api.fetchAgentLeads as jest.Mock;
const acceptLead = api.acceptLead as jest.Mock;
const declineLead = api.declineLead as jest.Mock;

const item = (n: number, over: Partial<AgentLeadListItem> = {}): AgentLeadListItem => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  createdAt: '2026-10-06T10:00:00.000Z',
  assignedAt: `2026-10-06T1${n}:00:00.000Z`,
  acceptedAt: null,
  kind: 'tour_request',
  status: 'assigned',
  listing: {
    id: '22222222-2222-4222-8222-222222222222',
    title: `Home ${n}`,
    address: `${n} Oak St, Rockville, MD`,
    state: 'MD',
    listPrice: 450000,
    status: 'Active',
  },
  emailMasked: 'b***@example.com',
  phoneMasked: '***-***-0100',
  ...over,
});

beforeEach(() => {
  fetchAgentLeads.mockReset();
  acceptLead.mockReset();
  declineLead.mockReset();
});

it('shows a skeleton, then new assignments before the rest', async () => {
  fetchAgentLeads.mockResolvedValue({
    results: [item(1, { status: 'contacted' }), item(2), item(3)],
  });
  render(<AgentLeadsList />);
  expect(screen.getByTestId('agent-leads-skeleton')).toBeInTheDocument();
  await screen.findByText('Home 2');
  const titles = screen.getAllByText(/^Home \d$/).map((e) => e.textContent);
  expect(titles).toEqual(['Home 3', 'Home 2', 'Home 1']);
  expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(2);
  expect(screen.getAllByText(/b\*\*\*@example\.com · \*\*\*-\*\*\*-0100/).length).toBeGreaterThan(
    0,
  );
});

it('shows the contact unavailable when the lookup failed (#691)', async () => {
  fetchAgentLeads.mockResolvedValue({ results: [item(1, { emailMasked: null })] });
  render(<AgentLeadsList />);
  expect(await screen.findByText(/Unavailable, retry/)).toBeInTheDocument();
  expect(screen.getByText('Home 1')).toBeInTheDocument();
});

it('shows an empty state', async () => {
  fetchAgentLeads.mockResolvedValue({ results: [] });
  render(<AgentLeadsList />);
  expect(await screen.findByText('No leads are assigned to you yet.')).toBeInTheDocument();
});

it('accepts a lead and reloads the list', async () => {
  fetchAgentLeads
    .mockResolvedValueOnce({ results: [item(1)] })
    .mockResolvedValueOnce({ results: [item(1, { status: 'accepted' })] });
  acceptLead.mockResolvedValue(undefined);
  render(<AgentLeadsList />);
  fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(acceptLead).toHaveBeenCalledWith(item(1).id));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull());
  expect(screen.getByText('Accepted')).toBeInTheDocument();
});

it('declines with a reason from the fixed list', async () => {
  fetchAgentLeads
    .mockResolvedValueOnce({ results: [item(1)] })
    .mockResolvedValueOnce({ results: [] });
  declineLead.mockResolvedValue(undefined);
  render(<AgentLeadsList />);
  fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
  const dialog = await screen.findByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: 'Decline lead' });
  expect(confirm).toBeDisabled();
  fireEvent.click(within(dialog).getByLabelText('Outside my service area'));
  fireEvent.click(confirm);
  await waitFor(() => expect(declineLead).toHaveBeenCalledWith(item(1).id, 'outside_service_area'));
  expect(await screen.findByText('No leads are assigned to you yet.')).toBeInTheDocument();
});

it('shows the service message when an accept fails', async () => {
  fetchAgentLeads.mockResolvedValue({ results: [item(1)] });
  acceptLead.mockRejectedValue(new StaffApiError('conflict', 'This lead cannot move.'));
  render(<AgentLeadsList />);
  fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
  expect(await screen.findByText('This lead cannot move.')).toBeInTheDocument();
});

it('offers a retry when the list fails', async () => {
  fetchAgentLeads
    .mockRejectedValueOnce(new StaffApiError('unavailable', 'Down.'))
    .mockResolvedValueOnce({ results: [] });
  render(<AgentLeadsList />);
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No leads are assigned to you yet.')).toBeInTheDocument();
});
