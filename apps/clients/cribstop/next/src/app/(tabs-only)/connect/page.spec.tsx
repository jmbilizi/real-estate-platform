import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BRAND } from '@/lib/brand';
import { getWaitlistInterests, joinWaitlist, leaveWaitlist } from '@/lib/api/waitlist';
import ConnectPage from './page';

jest.mock('@/lib/api/waitlist');

const mockToast = jest.fn();
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => '/connect',
  useSearchParams: () => new URLSearchParams(),
}));

let mockUser: { email: string } | null = null;
jest.mock('@/lib/context', () => ({
  useApp: () => ({ user: mockUser, sessionLoading: false }),
}));

const mockedGet = getWaitlistInterests as jest.Mock;
const mockedJoin = joinWaitlist as jest.Mock;
const mockedLeave = leaveWaitlist as jest.Mock;

describe('ConnectPage', () => {
  beforeEach(() => {
    mockUser = null;
    mockedGet.mockResolvedValue([]);
    mockedJoin.mockResolvedValue(undefined);
    mockedLeave.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('sends an anonymous visitor to the login modal and joins after sign-in', async () => {
    const user = userEvent.setup();
    const view = render(<ConnectPage />);

    await user.click(await screen.findByRole('button', { name: 'Join the Waitlist' }));
    expect(mockPush).toHaveBeenCalledWith('/connect?modal=login', { scroll: false });
    expect(mockedJoin).not.toHaveBeenCalled();

    mockUser = { email: 'a@example.com' };
    view.rerender(<ConnectPage />);
    await waitFor(() => expect(mockedJoin).toHaveBeenCalledWith('connect'));
    expect(await screen.findByRole('button', { name: /You're on the list/ })).toBeInTheDocument();
  });

  it('shows the joined state on revisit and withdraws', async () => {
    mockUser = { email: 'a@example.com' };
    mockedGet.mockResolvedValue(['connect']);
    const user = userEvent.setup();
    render(<ConnectPage />);

    const button = await screen.findByRole('button', { name: /You're on the list/ });
    await user.click(button);
    await waitFor(() => expect(mockedLeave).toHaveBeenCalledWith('connect'));
    expect(await screen.findByRole('button', { name: 'Join the Waitlist' })).toBeInTheDocument();
  });

  it('joins and rolls back with a toast when the request fails', async () => {
    mockUser = { email: 'a@example.com' };
    mockedJoin.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<ConnectPage />);

    await user.click(await screen.findByRole('button', { name: 'Join the Waitlist' }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(await screen.findByRole('button', { name: 'Join the Waitlist' })).toBeInTheDocument();
  });

  it('renders no fabricated counts, names or engagement', () => {
    const { container } = render(<ConnectPage />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/members|posts|trending|ago|Sarah|Marcus|Lisa/i);
    expect(text).not.toMatch(/[♥💬]/);
  });

  it('names the pillar from brand.ts and never hardcodes it', () => {
    const { container } = render(<ConnectPage />);
    expect(container.textContent).toContain(BRAND.pillars.connect);
    expect(container.textContent).not.toMatch(/Community|CribStop/);

    const source = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toMatch(/Community|CribStop|['"`>]Connect[ <'"`]/);
  });
});
