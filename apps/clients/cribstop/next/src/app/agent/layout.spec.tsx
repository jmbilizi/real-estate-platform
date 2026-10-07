import AgentLayout, { metadata } from './layout';
import { loadAgentGate } from '@/lib/api/agent-server';
import { notFound, redirect } from 'next/navigation';

jest.mock('@/lib/api/agent-server', () => ({ loadAgentGate: jest.fn() }));
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: jest.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

const gate = loadAgentGate as jest.Mock;

beforeEach(() => {
  gate.mockReset();
  (notFound as unknown as jest.Mock).mockClear();
  (redirect as unknown as jest.Mock).mockClear();
});

it('is noindex', () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});

it('renders for an agent with an active profile', async () => {
  gate.mockResolvedValue({ allowed: true, canRefresh: false });
  await expect(AgentLayout({ children: 'inside' })).resolves.toBeTruthy();
  expect(notFound).not.toHaveBeenCalled();
});

it('returns 404 for anyone else', async () => {
  gate.mockResolvedValue({ allowed: false, canRefresh: false });
  await expect(AgentLayout({ children: 'inside' })).rejects.toThrow('NEXT_NOT_FOUND');
});

it('sends an expired session through the refresh route once', async () => {
  gate.mockResolvedValue({ allowed: false, canRefresh: true });
  await expect(AgentLayout({ children: 'inside' })).rejects.toThrow('NEXT_REDIRECT');
  expect(redirect).toHaveBeenCalledWith('/api/staff/refresh?to=agent');
});
