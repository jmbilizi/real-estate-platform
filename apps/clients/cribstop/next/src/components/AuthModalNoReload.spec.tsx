import { act, render, screen } from '@testing-library/react';
import { useEffect, useSyncExternalStore } from 'react';
import AuthModalListener from './AuthModalListener';
import LoginPage from '@/app/login/page';
import SignupPage from '@/app/signup/page';
import { closeAuthModal, openAuthModal } from '@/lib/auth-modal';

const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn() };

function subscribe(cb: () => void) {
  window.addEventListener('locationchange', cb);
  window.addEventListener('popstate', cb);
  return () => {
    window.removeEventListener('locationchange', cb);
    window.removeEventListener('popstate', cb);
  };
}

// Mirrors Next.js, which keeps useSearchParams in step with native History calls.
jest.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        subscribe,
        () => window.location.search,
        () => '',
      ),
    ),
}));

jest.mock('./AuthForm', () => ({
  __esModule: true,
  default: ({ variant }: { variant: string }) => <div data-testid={`auth-form-${variant}`} />,
}));

let mounts = 0;
let fetches = 0;
function PageBehind() {
  useEffect(() => {
    mounts += 1;
    fetches += 1;
  }, []);
  return <div data-testid="page-behind">home</div>;
}

const realPush = window.history.pushState.bind(window.history);
const realReplace = window.history.replaceState.bind(window.history);
const realBack = window.history.back.bind(window.history);
const emit = () => window.dispatchEvent(new Event('locationchange'));

beforeEach(() => {
  mounts = 0;
  fetches = 0;
  Object.values(router).forEach((fn) => fn.mockClear());
  realReplace(null, '', '/');
  jest.spyOn(window.history, 'pushState').mockImplementation((s, t, u) => {
    realPush(s, t, u);
    emit();
  });
  jest.spyOn(window.history, 'replaceState').mockImplementation((s, t, u) => {
    realReplace(s, t, u);
    emit();
  });
});
afterEach(() => jest.restoreAllMocks());

describe('auth modal open and close (#908)', () => {
  it('opens and closes by History call, with no remount, refetch or router navigation', () => {
    render(
      <>
        <PageBehind />
        <AuthModalListener />
      </>,
    );
    const before = screen.getByTestId('page-behind');
    expect(screen.queryByTestId('auth-form-modal')).toBeNull();

    act(() => openAuthModal('login'));
    expect(window.location.search).toBe('?modal=login');
    expect(screen.getByTestId('auth-form-modal')).toBeInTheDocument();

    const back = jest.spyOn(window.history, 'back').mockImplementation(() => undefined);
    act(() => closeAuthModal());
    expect(back).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId('page-behind')).toBe(before);
    expect(mounts).toBe(1);
    expect(fetches).toBe(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('steps back on close when it pushed the entry, and keeps the other query params', () => {
    realReplace(null, '', '/search?q=dc');
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => {
      realBack();
    });
    render(<AuthModalListener />);

    act(() => openAuthModal('signup'));
    expect(window.location.search).toBe('?q=dc&modal=signup');

    act(() => closeAuthModal());
    expect(back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('close without a pushed entry removes only the modal params', () => {
    realReplace(null, '', '/search?q=dc&modal=login&mode=forgot');
    render(<AuthModalListener />);
    expect(screen.getByTestId('auth-form-modal')).toBeInTheDocument();

    act(() => closeAuthModal());
    expect(window.location.search).toBe('?q=dc');
    expect(screen.queryByTestId('auth-form-modal')).toBeNull();
  });

  it('renders the full auth page on a hard load of the login URL', () => {
    realReplace(null, '', '/login');
    render(<LoginPage />);
    expect(screen.getByTestId('auth-form-page')).toBeInTheDocument();
    render(<SignupPage />);
    expect(screen.getAllByTestId('auth-form-page')).toHaveLength(2);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
