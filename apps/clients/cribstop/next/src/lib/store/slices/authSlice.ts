import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { User } from '@/lib/store/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  sessionChecked: boolean;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  sessionChecked: false,
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
      state.user = { name: action.payload.email, email: action.payload.email };
      state.sessionChecked = true;
    },
    logout: (state) => {
      state.user = null;
      state.accessToken = null;
      state.sessionChecked = true;
    },
    setSessionChecked: (state) => {
      state.sessionChecked = true;
    },
  },
});

export const { login, signup, logout, setSessionChecked } = authSlice.actions;
export default authSlice.reducer;
