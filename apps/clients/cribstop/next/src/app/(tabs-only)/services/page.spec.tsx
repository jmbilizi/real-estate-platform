import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BRAND } from '@/lib/brand';
import { getWaitlistInterests, joinWaitlist, leaveWaitlist } from '@/lib/api/waitlist';
import ServicesPage from './page';

jest.mock('@/lib/api/waitlist');

const mockToast = jest.fn();
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => '/services',
  useSearchParams: () => new URLSearchParams(),
}));

let mockUser: { email: string } | null = null;
jest.mock('@/lib/context', () => ({
  useApp: () => ({ user: mockUser, sessionLoading: false }),
}));

const mockedGet = getWaitlistInterests as jest.Mock;
const mockedJoin = joinWaitlist as jest.Mock;
const mockedLeave = leaveWaitlist as jest.Mock;

const consumer = () => screen.getByRole('region', { name: 'Be the first to know' });
const provider = () => screen.getByRole('region', { name: 'Do you offer a home service?' });

describe('ServicesPage', () => {
  beforeEach(() => {
    mockUser = null;
    mockedGet.mockResolvedValue([]);
    mockedJoin.mockResolvedValue(undefined);
    mockedLeave.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('sends an anonymous consumer to the login modal and joins after sign-in', async () => {
    const user = userEvent.setup();
    const view = render(<ServicesPage />);

    await user.click(await within(consumer()).findByRole('button', { name: 'Join the Waitlist' }));
    expect(mockPush).toHaveBeenCalledWith('/services?modal=login', { scroll: false });
    expect(mockedJoin).not.toHaveBeenCalled();

    mockUser = { email: 'a@example.com' };
    view.rerender(<ServicesPage />);
    await waitFor(() => expect(mockedJoin).toHaveBeenCalledWith('services-consumer'));
    expect(
      await within(consumer()).findByRole('button', { name: /You're on the list/ }),
    ).toBeInTheDocument();
    expect(
      within(provider()).getByRole('button', { name: 'Register your interest' }),
    ).toBeInTheDocument();
  });

  it('sends an anonymous provider to the login modal and joins after sign-in', async () => {
    const user = userEvent.setup();
    const view = render(<ServicesPage />);

    await user.click(
      await within(provider()).findByRole('button', { name: 'Register your interest' }),
    );
    expect(mockPush).toHaveBeenCalledWith('/services?modal=login', { scroll: false });

    mockUser = { email: 'a@example.com' };
    view.rerender(<ServicesPage />);
    await waitFor(() => expect(mockedJoin).toHaveBeenCalledWith('services-provider'));
  });

  it('shows each joined state on revisit and withdraws one kind only', async () => {
    mockUser = { email: 'a@example.com' };
    mockedGet.mockResolvedValue(['services-consumer', 'services-provider']);
    const user = userEvent.setup();
    render(<ServicesPage />);

    const button = await within(provider()).findByRole('button', { name: /You're on the list/ });
    expect(
      within(consumer()).getByRole('button', { name: /You're on the list/ }),
    ).toBeInTheDocument();

    await user.click(button);
    await waitFor(() => expect(mockedLeave).toHaveBeenCalledWith('services-provider'));
    expect(mockedLeave).toHaveBeenCalledTimes(1);
    expect(
      await within(provider()).findByRole('button', { name: 'Register your interest' }),
    ).toBeInTheDocument();
    expect(
      within(consumer()).getByRole('button', { name: /You're on the list/ }),
    ).toBeInTheDocument();
  });

  it('joins and rolls back with a toast when the request fails', async () => {
    mockUser = { email: 'a@example.com' };
    mockedJoin.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<ServicesPage />);

    await user.click(await within(consumer()).findByRole('button', { name: 'Join the Waitlist' }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(
      await within(consumer()).findByRole('button', { name: 'Join the Waitlist' }),
    ).toBeInTheDocument();
  });

  it('renders no fabricated counts, names, ratings, fees or network claims', () => {
    const { container } = render(<ServicesPage />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(
      /rating|review|stars?|verified|vetted|certified|trusted|licensed|referral|commission|fee|free|discount|save|best|top-rated|first-time/i,
    );
  });

  it('names the pillar from brand.ts and never hardcodes it', () => {
    const { container } = render(<ServicesPage />);
    expect(container.textContent).toContain(BRAND.pillars.services);
    expect(container.textContent).not.toMatch(/CribStop/);

    const source = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toMatch(/CribStop|['"`>]Services[ <'"`]/);
  });
});
