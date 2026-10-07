import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { StaffLeadDetail } from '@cribstop/property-contracts';
import LeadDetail from './LeadDetail';
import * as api from '@/lib/api/staff-leads';

jest.mock('@/lib/api/staff-leads', () => ({
  ...jest.requireActual('@/lib/api/staff-leads'),
  fetchLead: jest.fn(),
  transitionLead: jest.fn(),
  addLeadNote: jest.fn(),
}));

const fetchLead = api.fetchLead as jest.Mock;
const transitionLead = api.transitionLead as jest.Mock;
const addLeadNote = api.addLeadNote as jest.Mock;

const ID = '11111111-1111-4111-8111-111111111111';
const lead = (over: Partial<StaffLeadDetail> = {}): StaffLeadDetail => ({
  id: ID,
  createdAt: '2026-10-06T12:00:00.000Z',
  kind: 'tour_request',
  status: 'new',
  name: 'Sam Rivera',
  email: 'sam@example.com',
  phone: '(202) 555-0100',
  message: 'Can I see it Saturday?',
  verifiedAccount: true,
  consent: {
    given: true,
    textVersion: 'v1',
    text: 'I agree to be contacted.',
    channels: ['email'],
    givenAt: '2026-10-06T12:00:00.000Z',
  },
  listing: {
    id: '22222222-2222-4222-8222-222222222222',
    title: '12 Oak St',
    address: '12 Oak St, Rockville, MD',
    listPrice: 450000,
    status: 'Active',
  },
  possibleDuplicate: true,
  duplicateLeadIds: ['33333333-3333-4333-8333-333333333333'],
  history: [
    {
      id: 'e1',
      fromStatus: null,
      toStatus: 'new',
      actorAccountId: null,
      actorRole: 'System',
      note: null,
      agentProfileId: null,
      createdAt: '2026-10-06T12:00:00.000Z',
    },
  ],
  notes: [],
  assignments: [],
  ...over,
});

beforeEach(() => {
  fetchLead.mockReset().mockResolvedValue(lead());
  transitionLead.mockReset().mockResolvedValue(undefined);
  addLeadNote.mockReset();
});

async function open() {
  render(<LeadDetail id={ID} />);
  await screen.findByRole('heading', { name: 'Sam Rivera' });
}

describe('LeadDetail', () => {
  it('shows a skeleton, then contact, consent, history and the duplicate flag', async () => {
    render(<LeadDetail id={ID} />);
    expect(screen.getByTestId('lead-detail-skeleton')).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Sam Rivera' });
    expect(screen.getByRole('link', { name: 'sam@example.com' })).toHaveAttribute(
      'href',
      'mailto:sam@example.com',
    );
    expect(screen.getByRole('link', { name: '(202) 555-0100' })).toHaveAttribute(
      'href',
      'tel:2025550100',
    );
    expect(screen.getByText('Possible duplicate')).toBeInTheDocument();
    expect(screen.getByText('Verified account')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('Status history')).toBeInTheDocument();
  });

  it('shows the Fair Housing hint beside the note field', async () => {
    await open();
    expect(screen.getByText('Do not record protected characteristics.')).toBeInTheDocument();
  });

  it('offers only the actions the status allows', async () => {
    fetchLead.mockResolvedValue(lead({ status: 'verified' }));
    await open();
    fireEvent.click(screen.getAllByRole('button', { name: 'Take action' })[0]);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Mark as spam' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('offers no action on a final status', async () => {
    fetchLead.mockResolvedValue(lead({ status: 'closed' }));
    await open();
    expect(screen.queryByRole('button', { name: 'Take action' })).toBeNull();
  });

  it('verifies without a note', async () => {
    await open();
    fireEvent.click(screen.getAllByRole('button', { name: 'Take action' })[0]);
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Verify' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(transitionLead).toHaveBeenCalledWith(ID, 'verified', undefined));
    await waitFor(() => expect(fetchLead).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['Mark as spam', 'spam'],
    ['Reject', 'rejected'],
  ])('%s needs a note', async (label, to) => {
    await open();
    fireEvent.click(screen.getAllByRole('button', { name: 'Take action' })[0]);
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: label }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Confirm' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(/note is required/i);
    expect(transitionLead).not.toHaveBeenCalled();

    fireEvent.change(within(sheet).getByLabelText(/Note/), { target: { value: ' bot ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(transitionLead).toHaveBeenCalledWith(ID, to, 'bot'));
  });

  it('shows the 409 text and reloads the lead', async () => {
    transitionLead.mockRejectedValue(
      new api.StaffApiError('conflict', 'This request cannot move to that status.'),
    );
    await open();
    fireEvent.click(screen.getAllByRole('button', { name: 'Take action' })[0]);
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Verify' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Confirm' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'This request cannot move to that status.',
    );
    await waitFor(() => expect(fetchLead).toHaveBeenCalledTimes(2));
  });

  it('adds a note to the view without reloading', async () => {
    addLeadNote.mockResolvedValue({
      id: 'n1',
      authorAccountId: ID,
      authorRole: 'Moderator',
      body: 'Left a voicemail.',
      createdAt: '2026-10-07T09:00:00.000Z',
    });
    await open();
    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Left a voicemail.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Left a voicemail.')).toBeInTheDocument();
    expect(addLeadNote).toHaveBeenCalledWith(ID, 'Left a voicemail.');
    expect(fetchLead).toHaveBeenCalledTimes(1);
  });

  it('does not send an empty note', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write a note first.');
    expect(addLeadNote).not.toHaveBeenCalled();
  });

  it('shows the error with no retry for a missing lead', async () => {
    fetchLead.mockRejectedValue(new api.StaffApiError('not_found', 'Gone.'));
    render(<LeadDetail id={ID} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Gone.');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
