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
      const existingIndex = state.savedIds.indexOf(id);
      if (existingIndex >= 0) {
        state.savedIds.splice(existingIndex, 1);
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
