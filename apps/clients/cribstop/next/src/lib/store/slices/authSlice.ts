import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { User } from '@/lib/store/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login: (state, action: PayloadAction<{ email: string; accessToken?: string }>) => {
      state.user = { name: action.payload.email, email: action.payload.email };
      state.accessToken = action.payload.accessToken ?? null;
    },
    signup: (state, action: PayloadAction<{ name: string; email: string }>) => {
      state.user = { name: action.payload.name, email: action.payload.email };
    },
    logout: (state) => {
      state.user = null;
      state.accessToken = null;
    },
  },
});

export const { login, signup, logout } = authSlice.actions;
export default authSlice.reducer;
