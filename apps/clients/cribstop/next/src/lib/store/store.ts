import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/lib/store/slices/authSlice';
import favoritesReducer from '@/lib/store/slices/favoritesSlice';
import searchReducer from '@/lib/store/slices/searchSlice';
import uiReducer from '@/lib/store/slices/uiSlice';
import toastReducer from '@/lib/store/slices/toastSlice';

export const AUTH_CACHE_KEY = 'cribstop_auth';

// Read cached auth synchronously at module load time (client only).
// Providing it as preloadedState means the store is initialised with the
// correct user before React's first render — no dispatch needed, no re-render,
// no flash.
function loadPreloadedAuth(): {
  user: { name: string; email: string } | null;
  accessToken: string | null;
  sessionChecked: boolean;
} {
  if (typeof window === 'undefined')
    return { user: null, accessToken: null, sessionChecked: false };
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as {
        user?: { name: string; email: string } | null;
        accessToken?: string | null;
      };
      if (cached.user?.email) {
        return { user: cached.user, accessToken: cached.accessToken ?? null, sessionChecked: true };
      }
    }
  } catch {}
  return { user: null, accessToken: null, sessionChecked: true };
}

export const store = configureStore({
  reducer: {
    auth: authReducer,
    favorites: favoritesReducer,
    search: searchReducer,
    ui: uiReducer,
    toast: toastReducer,
  },
  preloadedState: {
    auth: loadPreloadedAuth(),
  },
});

// Keep localStorage in sync so future reloads can preload the correct state
let _prevAuth = store.getState().auth;
store.subscribe(() => {
  if (typeof window === 'undefined') return;
  const auth = store.getState().auth;
  if (auth === _prevAuth) return;
  _prevAuth = auth;
  try {
    localStorage.setItem(
      AUTH_CACHE_KEY,
      JSON.stringify({ user: auth.user, accessToken: auth.accessToken }),
    );
  } catch {}
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
