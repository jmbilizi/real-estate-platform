import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { User } from '@/lib/store/types';

interface AuthState {
  user: User | null;
}

const initialState: AuthState = {
  user: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login: (state, action: PayloadAction<{ email: string; password: string }>) => {
      state.user = { name: 'Alex Johnson', email: action.payload.email, avatar: undefined };
    },
    signup: (state, action: PayloadAction<{ name: string; email: string; password: string }>) => {
      state.user = { name: action.payload.name, email: action.payload.email };
    },
    logout: (state) => {
      state.user = null;
    },
  },
});

export const { login, signup, logout } = authSlice.actions;
export default authSlice.reducer;
