import { FORBIDDEN_COLUMNS, LISTING_CARD_SELECT, LISTING_DETAIL_SELECT } from './columns';

describe('read-model columns', () => {
  it.each([LISTING_CARD_SELECT, LISTING_DETAIL_SELECT])('never uses a wildcard (%#)', (select) => {
    expect(select).not.toMatch(/\*/);
  });

  it('never selects street_line — the view still carries it unmasked (#48)', () => {
    expect(FORBIDDEN_COLUMNS).toContain('street_line');
    for (const select of [LISTING_CARD_SELECT, LISTING_DETAIL_SELECT]) {
      for (const forbidden of FORBIDDEN_COLUMNS) {
        expect(select).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
      }
    }
  });

  it('keeps description off the card projection and on the detail projection', () => {
    expect(LISTING_CARD_SELECT).not.toMatch(/\bdescription\b/);
    expect(LISTING_DETAIL_SELECT).toMatch(/\bdescription\b/);
  });
});
