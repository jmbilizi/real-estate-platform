import {
  type ListingCardRow,
  marketStatusSchema,
  propertyPagePath,
  type SavedHome,
  savedHomeSchema,
} from '@cribstop/property-contracts';
import { latestOf } from '../listings/property-page';
import {
  findHomeFacts,
  findHomeRowsForHomes,
  findListingCardsByIds,
  type HomeFactsDbRow,
  type HomeRowDbRow,
  type ReadClient,
} from '../listings/repository';
import { applyCardAddressSuppression } from '../listings/suppression';
import type { SavedHomeDbRow } from './store';

/**
 * Builds the home-shaped saved list (#23) from saved rows. Three statements for the whole page,
 * never one per home (#76).
 *
 * Masking follows the property page (#382) and never reads the street line itself:
 *  - `listing_detail_v` masks the address per listing, and `listing_search_v` masks each card.
 *  - One listing of the home that withheld the address masks it for the whole home. A saved home
 *    that showed another listing's address would tie the withheld listing to it.
 *  - A home with no readable listing (all deleted or withheld from the internet) has no address.
 *    The opt-out applies to the address and coordinates, never to the existence of the home.
 *  - Price, status and photos come only from the card, so the view's withholding is final.
 */

function toNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function groupByHome(rows: readonly HomeRowDbRow[]): Map<string, HomeRowDbRow[]> {
  const byHome = new Map<string, HomeRowDbRow[]>();
  for (const row of rows) {
    const held = byHome.get(row.home_id);
    if (held === undefined) byHome.set(row.home_id, [row]);
    else held.push(row);
  }
  return byHome;
}

function maskedCard(card: ListingCardRow, canonicalPath: string | null): ListingCardRow {
  if (card.address === null) return card;
  return applyCardAddressSuppression({
    ...card,
    address: null,
    latitude: null,
    longitude: null,
    propertyPath: canonicalPath ?? card.propertyPath,
  });
}

function assemble(
  saved: SavedHomeDbRow,
  facts: HomeFactsDbRow,
  rows: readonly HomeRowDbRow[],
  cards: ReadonlyMap<string, ListingCardRow>,
): SavedHome {
  const latest = latestOf(rows);
  const masked = latest === null || rows.some((row) => row.address_street === null);
  const address = masked ? null : latest.address_street;
  const unitNumber = address === null || latest === null ? null : latest.unit_number;
  const canonicalPath =
    latest === null
      ? null
      : propertyPagePath(
          { streetLine: address, unitNumber, city: latest.city, state: latest.state },
          latest.id,
        );
  const card =
    latest !== null && latest.listing_data_displayable ? cards.get(latest.id) : undefined;
  const listing =
    card === undefined
      ? null
      : { ...maskedCard(card, canonicalPath), isSaved: true, isFavorited: true };

  return savedHomeSchema.parse({
    propertyId: saved.property_id,
    savedAt: new Date(saved.created_at).toISOString(),
    savedFromListingId: saved.listing_id,
    marketStatus: listing === null ? 'Off market' : marketStatusSchema.parse(latest?.market_status),
    canonicalPath,
    property: {
      address,
      unitNumber,
      city: facts.city,
      state: facts.state,
      zip: facts.zip,
      neighborhood: facts.neighborhood,
      propertyType: facts.property_type,
      beds: facts.beds,
      baths: toNumber(facts.baths),
      sqft: facts.sqft,
      lotSqft: facts.lot_sqft,
      yearBuilt: facts.year_built,
      isSample: facts.is_sample,
    },
    listing,
  });
}

export async function buildSavedHomes(
  pool: ReadClient,
  savedRows: readonly SavedHomeDbRow[],
): Promise<SavedHome[]> {
  const homeIds = savedRows.map((row) => row.property_id);
  const [factRows, homeRows] = await Promise.all([
    findHomeFacts(pool, homeIds),
    findHomeRowsForHomes(pool, homeIds),
  ]);
  const factsByHome = new Map(factRows.map((fact) => [fact.home_id, fact]));
  const rowsByHome = groupByHome(homeRows);

  const wanted: string[] = [];
  for (const [, rows] of rowsByHome) {
    const latest = latestOf(rows);
    if (latest !== null && latest.listing_data_displayable) wanted.push(latest.id);
  }
  const cards = await findListingCardsByIds(pool, wanted);

  const homes: SavedHome[] = [];
  for (const saved of savedRows) {
    const facts = factsByHome.get(saved.property_id);
    if (facts === undefined) {
      // A property row is never deleted, so this means a save for an id that was never a home.
      console.warn('Saved home has no property row; left out of the list.', saved.property_id);
      continue;
    }
    homes.push(assemble(saved, facts, rowsByHome.get(saved.property_id) ?? [], cards));
  }
  return homes;
}
