import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface FavoritesState {
  savedIds: string[];
}

const initialState: FavoritesState = {
  savedIds: [],
};

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState,
  reducers: {
    toggleSave: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      if (state.savedIds.includes(id)) {
        state.savedIds = state.savedIds.filter((savedId) => savedId !== id);
        return;
      }
      state.savedIds.push(id);
    },
    clearSaved: (state) => {
      state.savedIds = [];
    },
  },
});

export const { toggleSave, clearSaved } = favoritesSlice.actions;
export default favoritesSlice.reducer;
