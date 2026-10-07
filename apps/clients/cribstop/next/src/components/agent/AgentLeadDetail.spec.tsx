import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AGENT_BUYER_AGREEMENT_REMINDER, type AgentLeadDetail } from '@cribstop/property-contracts';
import AgentLeadDetailView from './AgentLeadDetail';
import * as api from '@/lib/api/agent-leads';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/api/agent-leads', () => ({
  fetchAgentLead: jest.fn(),
  acceptLead: jest.fn(),
  declineLead: jest.fn(),
  setLeadStatus: jest.fn(),
}));
const fetchAgentLead = api.fetchAgentLead as jest.Mock;
const acceptLead = api.acceptLead as jest.Mock;
const declineLead = api.declineLead as jest.Mock;
const setLeadStatus = api.setLeadStatus as jest.Mock;

const ID = '11111111-1111-4111-8111-111111111111';
const lead = (over: Partial<AgentLeadDetail> = {}): AgentLeadDetail => ({
  id: ID,
  createdAt: '2026-10-06T10:00:00.000Z',
  assignedAt: '2026-10-06T11:00:00.000Z',
  acceptedAt: null,
  kind: 'tour_request',
  status: 'assigned',
  listing: {
    id: '22222222-2222-4222-8222-222222222222',
    title: '12 Oak St',
    address: '12 Oak St, Rockville, MD',
    listPrice: 450000,
    status: 'Active',
  },
  emailMasked: 's***@example.com',
  phoneMasked: '***-***-0100',
  contact: null,
  buyerAgreementReminder: AGENT_BUYER_AGREEMENT_REMINDER,
  ...over,
});
const accepted = (status: AgentLeadDetail['status'] = 'accepted') =>
  lead({
    status,
    acceptedAt: '2026-10-06T11:05:00.000Z',
    contact: {
      name: 'Sam Rivera',
      email: 'sam@example.com',
      phone: '(202) 555-0100',
      message: 'Can I see it Saturday?',
      consent: { given: true, text: null, channels: ['email'], givenAt: null },
    },
  });

beforeEach(() => {
  [fetchAgentLead, acceptLead, declineLead, setLeadStatus, push].forEach((m) =>
    (m as jest.Mock).mockReset(),
  );
});

it('before accept: masked contact, Accept and Decline, no status steps', async () => {
  fetchAgentLead.mockResolvedValue(lead());
  render(<AgentLeadDetailView id={ID} />);
  expect(screen.getByTestId('agent-detail-skeleton')).toBeInTheDocument();
  expect(await screen.findByText('s***@example.com')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /sam@example.com/ })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Accept' }).length).toBeGreaterThan(0);
  expect(screen.queryByText(/Mark as/)).toBeNull();
});

it('accept reloads the lead and shows the contact', async () => {
  fetchAgentLead.mockResolvedValueOnce(lead()).mockResolvedValueOnce(accepted());
  acceptLead.mockResolvedValue(undefined);
  render(<AgentLeadDetailView id={ID} />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Accept' }))[0]);
  await waitFor(() => expect(acceptLead).toHaveBeenCalledWith(ID));
  const call = await screen.findByRole('link', { name: /Call \(202\) 555-0100/ });
  expect(call).toHaveAttribute('href', 'tel:2025550100');
  expect(screen.getByRole('link', { name: /Email sam@example.com/ })).toHaveAttribute(
    'href',
    'mailto:sam@example.com',
  );
  expect(screen.getByText('You accepted')).toBeInTheDocument();
  expect(screen.getByText(/Consented channels:/)).toBeInTheDocument();
});

it('decline sends the reason and returns to the list', async () => {
  fetchAgentLead.mockResolvedValue(lead());
  declineLead.mockResolvedValue(undefined);
  render(<AgentLeadDetailView id={ID} />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Decline' }))[0]);
  fireEvent.click(await screen.findByLabelText('Conflict of interest'));
  fireEvent.click(screen.getByRole('button', { name: 'Decline lead' }));
  await waitFor(() => expect(declineLead).toHaveBeenCalledWith(ID, 'conflict_of_interest'));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/agent/leads'));
});

it('after accept: only allowed steps, the tour reminder and the notes hint', async () => {
  fetchAgentLead.mockResolvedValue(accepted());
  render(<AgentLeadDetailView id={ID} />);
  expect(await screen.findByRole('button', { name: 'Mark as contacted' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark as lost' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark as touring' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mark as closed' })).toBeNull();
  expect(screen.getByText('Do not record protected characteristics.')).toBeInTheDocument();
});

it('shows the buyer agreement reminder when touring is the next step, and sends the note', async () => {
  fetchAgentLead.mockResolvedValue(accepted('contacted'));
  setLeadStatus.mockResolvedValue(undefined);
  render(<AgentLeadDetailView id={ID} />);
  expect(
    await screen.findByText('A written buyer agreement may be required before touring.'),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Note/), { target: { value: ' Booked Sat ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mark as touring' }));
  await waitFor(() => expect(setLeadStatus).toHaveBeenCalledWith(ID, 'touring', 'Booked Sat'));
});

it('shows no actions for a closed lead', async () => {
  fetchAgentLead.mockResolvedValue(accepted('closed'));
  render(<AgentLeadDetailView id={ID} />);
  expect(await screen.findByText(/No more updates are available/)).toBeInTheDocument();
  expect(screen.queryByText(/Mark as/)).toBeNull();
});

it('shows a not-found state for a lead that is not the caller’s', async () => {
  const { StaffApiError } = jest.requireActual('@/lib/api/staff-leads');
  fetchAgentLead.mockRejectedValue(new StaffApiError('not_found', 'Lead not found.'));
  render(<AgentLeadDetailView id={ID} />);
  expect(await screen.findByText('Lead not found.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});
