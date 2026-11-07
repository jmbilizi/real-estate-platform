import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BRAND } from '@/lib/brand';
import { getWaitlistInterests, joinWaitlist, leaveWaitlist } from '@/lib/api/waitlist';
import ListPage from './page';

jest.mock('@/lib/api/waitlist');

const mockToast = jest.fn();
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));

let mockUser: { email: string } | null = null;
jest.mock('@/lib/context', () => ({
  useApp: () => ({ user: mockUser, sessionLoading: false }),
}));

const mockedGet = getWaitlistInterests as jest.Mock;
const mockedJoin = joinWaitlist as jest.Mock;
const mockedLeave = leaveWaitlist as jest.Mock;

const JOIN = 'Join the list-a-property waitlist';

describe('ListPage', () => {
  let pushState: jest.SpyInstance;
  beforeEach(() => {
    mockUser = null;
    mockedGet.mockResolvedValue([]);
    mockedJoin.mockResolvedValue(undefined);
    mockedLeave.mockResolvedValue(undefined);
    pushState = jest.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
  });
  afterEach(() => {
    pushState.mockRestore();
    jest.clearAllMocks();
  });

  it('sends a signed-out visitor to the login modal and joins after sign-in', async () => {
    const user = userEvent.setup();
    const view = render(<ListPage />);

    await user.click(await screen.findByRole('button', { name: JOIN }));
    expect(pushState).toHaveBeenCalledWith(null, '', '/?modal=login');
    expect(mockedJoin).not.toHaveBeenCalled();

    mockUser = { email: 'a@example.com' };
    view.rerender(<ListPage />);
    await waitFor(() => expect(mockedJoin).toHaveBeenCalledWith('list-property'));
    expect(await screen.findByRole('button', { name: /You're on the list/ })).toBeInTheDocument();
  });

  it('joins directly when signed in', async () => {
    mockUser = { email: 'a@example.com' };
    const user = userEvent.setup();
    render(<ListPage />);

    await user.click(await screen.findByRole('button', { name: JOIN }));
    await waitFor(() => expect(mockedJoin).toHaveBeenCalledWith('list-property'));
  });

  it('shows the joined state on revisit and leaves on a second tap', async () => {
    mockUser = { email: 'a@example.com' };
    mockedGet.mockResolvedValue(['list-property']);
    const user = userEvent.setup();
    render(<ListPage />);

    await user.click(await screen.findByRole('button', { name: /You're on the list/ }));
    await waitFor(() => expect(mockedLeave).toHaveBeenCalledWith('list-property'));
    expect(await screen.findByRole('button', { name: JOIN })).toBeInTheDocument();
  });

  it('rolls back and shows a toast when the join fails', async () => {
    mockUser = { email: 'a@example.com' };
    mockedJoin.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<ListPage />);

    await user.click(await screen.findByRole('button', { name: JOIN }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(await screen.findByRole('button', { name: JOIN })).toBeInTheDocument();
  });

  it('promises no listing tools, uploads, leads or independent listing', () => {
    const { container } = render(<ListPage />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/not open yet/);
    expect(text).not.toMatch(/MLS|photo|upload|lead|FSBO|FRBO|independent|without an agent/i);
    expect(text).not.toMatch(/\d/);
  });

  it('names the licensed brokerage from brand.ts and never hardcodes brand text', () => {
    const { container } = render(<ListPage />);
    expect(container.textContent).toContain(BRAND.brokerage);

    const source = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toMatch(/CribStop|Real Broker/);
  });

  it('keeps the page shell a server component', () => {
    const source = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toMatch(/['"]use client['"]/);
  });
});
