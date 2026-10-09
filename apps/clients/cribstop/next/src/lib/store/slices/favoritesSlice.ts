import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/**
 * The store keys on the home (`propertyId`), never on the listing (#25).
 * The server keys a save on `(account_id, property_id)` (#23). Bright issues a new listing row when
 * the listing agreement changes, so a listing key would detach from the home the consumer saved.
 * One home has many listings, so one flip changes the heart on every card, pin, popup and modal.
 *
 * `listingId` is display context only: the listing the consumer saved from. A signed-out save
 * keeps it so that sign-in can ask the server to resolve it to the home.
 */
export interface SavedEntry {
  propertyId: string;
  listingId: string | null;
}

interface FavoritesState {
  homes: SavedEntry[];
}

const initialState: FavoritesState = {
  homes: [],
};

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState,
  reducers: {
    /** Idempotent. A second listing of a saved home changes nothing. */
    saveEntry: (state, action: PayloadAction<SavedEntry>) => {
      if (state.homes.some((h) => h.propertyId === action.payload.propertyId)) return;
      state.homes.push(action.payload);
    },
    unsaveEntry: (state, action: PayloadAction<string>) => {
      state.homes = state.homes.filter((h) => h.propertyId !== action.payload);
    },
    /** The server is the source of truth after a sign-in. */
    replaceSaved: (state, action: PayloadAction<SavedEntry[]>) => {
      state.homes = action.payload;
    },
    clearSaved: (state) => {
      state.homes = [];
    },
  },
});

export const { saveEntry, unsaveEntry, replaceSaved, clearSaved } = favoritesSlice.actions;
export default favoritesSlice.reducer;
