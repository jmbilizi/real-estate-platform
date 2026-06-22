import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { User } from '@/lib/store/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  sessionChecked: boolean;
  showOnboarding: boolean;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  sessionChecked: false,
  showOnboarding: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login: (state, action: PayloadAction<{ email: string; accessToken?: string }>) => {
      state.user = { name: action.payload.email, email: action.payload.email };
      state.accessToken = action.payload.accessToken ?? null;
      state.sessionChecked = true;
    },
    signup: (state, action: PayloadAction<{ email: string }>) => {
      state.user = {
        name: action.payload.email,
        email: action.payload.email,
        profileComplete: false,
      };
      state.sessionChecked = true;
      state.showOnboarding = true;
    },
    logout: (state) => {
      state.user = null;
      state.accessToken = null;
      state.sessionChecked = true;
      state.showOnboarding = false;
    },
    setSessionChecked: (state) => {
      state.sessionChecked = true;
    },
    updateProfile: (state, action: PayloadAction<Partial<User>>) => {
      if (state.user) {
        Object.assign(state.user, action.payload);
        if (action.payload.firstName || action.payload.lastName) {
          const first = action.payload.firstName ?? state.user.firstName ?? '';
          const last = action.payload.lastName ?? state.user.lastName ?? '';
          state.user.name =
            action.payload.displayName ||
            [first, last].filter(Boolean).join(' ') ||
            state.user.email;
        }
      }
    },
    setShowOnboarding: (state, action: PayloadAction<boolean>) => {
      state.showOnboarding = action.payload;
    },
    dismissOnboarding: (state) => {
      state.showOnboarding = false;
      if (state.user) {
        state.user.profileComplete = true;
      }
    },
  },
});

export const {
  login,
  signup,
  logout,
  setSessionChecked,
  updateProfile,
  setShowOnboarding,
  dismissOnboarding,
} = authSlice.actions;
export default authSlice.reducer;
