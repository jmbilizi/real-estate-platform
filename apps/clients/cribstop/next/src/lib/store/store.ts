import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/lib/store/slices/authSlice';
import favoritesReducer from '@/lib/store/slices/favoritesSlice';
import searchReducer from '@/lib/store/slices/searchSlice';
import uiReducer from '@/lib/store/slices/uiSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    favorites: favoritesReducer,
    search: searchReducer,
    ui: uiReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
