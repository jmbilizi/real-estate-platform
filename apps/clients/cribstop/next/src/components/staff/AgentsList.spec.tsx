import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AgentProfile } from '@cribstop/property-contracts';
import AgentsList, { parseStates } from './AgentsList';
import * as api from '@/lib/api/staff-agents';

jest.mock('@/lib/api/staff-agents', () => ({
  fetchAgents: jest.fn(),
  createAgent: jest.fn(),
  updateAgent: jest.fn(),
}));
const fetchAgents = api.fetchAgents as jest.Mock;
const createAgent = api.createAgent as jest.Mock;
const updateAgent = api.updateAgent as jest.Mock;

const agent = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  id: '44444444-4444-4444-8444-444444444444',
  accountId: '55555555-5555-4555-8555-555555555555',
  displayName: 'Ana Agent',
  licenceNumber: 'L1',
  licenceStates: ['MD', 'DC'],
  brokerage: 'Real Broker, LLC',
  active: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  fetchAgents
    .mockReset()
    .mockResolvedValue([agent(), agent({ id: 'b', displayName: 'Off Agent', active: false })]);
  createAgent.mockReset().mockResolvedValue(agent());
  updateAgent.mockReset().mockResolvedValue(agent());
});

describe('parseStates', () => {
  it('upper-cases, splits on commas and spaces and drops repeats', () => {
    expect(parseStates('md, dc va,MD')).toEqual(['MD', 'DC', 'VA']);
  });
});

describe('AgentsList for a Moderator', () => {
  it('shows the list with no write control', async () => {
    render(<AgentsList canWrite={false} />);
    expect(screen.getByTestId('agents-skeleton')).toBeInTheDocument();
    expect(await screen.findByText('Ana Agent')).toBeInTheDocument();
    for (const name of ['Add agent', 'Edit', 'Deactivate', 'Reactivate']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});

describe('AgentsList for an Admin', () => {
  it('filters by status and licence state', async () => {
    render(<AgentsList canWrite />);
    await screen.findByText('Ana Agent');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'true' } });
    fireEvent.change(screen.getByLabelText(/Licensed in/), { target: { value: 'md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() =>
      expect(fetchAgents).toHaveBeenLastCalledWith({ active: 'true', licenceState: 'MD' }),
    );
  });

  it('rejects a bad filter state without a call', async () => {
    render(<AgentsList canWrite />);
    await screen.findByText('Ana Agent');
    fireEvent.change(screen.getByLabelText(/Licensed in/), { target: { value: 'M' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('two-letter');
    expect(fetchAgents).toHaveBeenCalledTimes(1);
  });

  it('creates an agent', async () => {
    render(<AgentsList canWrite />);
    await screen.findByText('Ana Agent');
    fireEvent.click(screen.getByRole('button', { name: 'Add agent' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('account ID');
    expect(createAgent).not.toHaveBeenCalled();
    fireEvent.change(within(sheet).getByLabelText('Account ID'), {
      target: { value: '55555555-5555-4555-8555-555555555555' },
    });
    fireEvent.change(within(sheet).getByLabelText('Display name'), { target: { value: ' Ana ' } });
    fireEvent.change(within(sheet).getByLabelText('Licence number'), { target: { value: 'L9' } });
    fireEvent.change(within(sheet).getByLabelText(/Licence states/), {
      target: { value: 'md, dc' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(createAgent).toHaveBeenCalledWith({
        accountId: '55555555-5555-4555-8555-555555555555',
        displayName: 'Ana',
        licenceNumber: 'L9',
        licenceStates: ['MD', 'DC'],
        active: true,
      }),
    );
    await waitFor(() => expect(fetchAgents).toHaveBeenCalledTimes(2));
  });

  it('refuses a malformed state code', async () => {
    render(<AgentsList canWrite />);
    await screen.findByText('Ana Agent');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByLabelText(/Licence states/), {
      target: { value: 'MARYLAND' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('two-letter');
    expect(updateAgent).not.toHaveBeenCalled();
  });

  it('edits without the account field', async () => {
    render(<AgentsList canWrite />);
    await screen.findByText('Ana Agent');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).queryByLabelText('Account ID')).toBeNull();
    fireEvent.change(within(sheet).getByLabelText('Display name'), { target: { value: 'Ana B' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateAgent).toHaveBeenCalledWith(agent().id, {
        displayName: 'Ana B',
        licenceNumber: 'L1',
        licenceStates: ['MD', 'DC'],
      }),
    );
  });

  it('deactivates after a confirm and reactivates in one tap', async () => {
    render(<AgentsList canWrite />);
    await screen.findByText('Ana Agent');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    const sheet = await screen.findByRole('dialog');
    expect(updateAgent).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(updateAgent).toHaveBeenCalledWith(agent().id, { active: false }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(updateAgent).toHaveBeenCalledWith('b', { active: true }));
  });

  it('shows the service message when a save fails', async () => {
    createAgent.mockRejectedValue(new Error('x'));
    updateAgent.mockRejectedValue(
      new (jest.requireActual('@/lib/api/staff-leads').StaffApiError)(
        'conflict',
        'Account has no Agent role.',
      ),
    );
    render(<AgentsList canWrite />);
    await screen.findByText('Ana Agent');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Deactivate' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Account has no Agent role.');
  });
});
