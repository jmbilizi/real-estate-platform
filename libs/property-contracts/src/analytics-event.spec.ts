import {
  ANALYTICS_BATCH_MAX,
  ANALYTICS_EVENT_NAMES,
  analyticsAccountLinkRequestSchema,
  analyticsEventBatchSchema,
  normalizeAnalyticsEvent,
  analyticsEventRequestSchema as schema,
  scrubQueryText,
} from './analytics-event';

const LISTING = '0190a000-0000-7000-8000-0000000000e1';
const SESSION = 'abcDEF123_-xyz789';
const ANON = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('analytics event contract v2 (#824)', () => {
  it('accepts every #725 body unchanged', () => {
    for (const event of ['search', 'listing_view', 'listing_save', 'lead_submit']) {
      const body = { event, surface: 'detail', listingId: LISTING, sessionId: SESSION };
      const parsed = schema.safeParse(body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const n = normalizeAnalyticsEvent(parsed.data);
        expect(n.sessionId).toBe(SESSION);
        expect(n.listingId).toBe(LISTING);
        expect(n.anonId).toBeNull();
      }
    }
  });

  it('knows every event in the ticket', () => {
    expect([...ANALYTICS_EVENT_NAMES].sort()).toEqual(
      [
        'page_view',
        'session_start',
        'listing_impression',
        'listing_click',
        'ui_click',
        'dwell',
        'search',
        'search_zero_result_text',
        'map_move',
        'listing_save',
        'listing_unsave',
        'listing_share',
        'lead_open',
        'lead_start',
        'lead_submit',
        'lead_error',
        'auth_identify_shown',
        'auth_code_sent',
        'auth_code_verified',
        'auth_signup_done',
        'auth_fail',
        'client_error',
        'api_error',
        'feed_impression',
        'feed_click',
        'listing_view',
      ].sort(),
    );
  });

  it('rejects an unknown event, an unknown property and a property of another event', () => {
    const base = { surface: 'search', session_id: SESSION };
    expect(schema.safeParse({ ...base, event: 'page_hover' }).success).toBe(false);
    expect(schema.safeParse({ ...base, event: 'page_view', email: 'a@b.co' }).success).toBe(false);
    expect(schema.safeParse({ ...base, event: 'page_view', listing_id: LISTING }).success).toBe(
      false,
    );
  });

  it('requires a session id', () => {
    expect(schema.safeParse({ event: 'page_view', surface: 'home' }).success).toBe(false);
  });

  it('accepts common properties and rejects bad values', () => {
    const ok = {
      event: 'page_view',
      surface: 'home',
      session_id: SESSION,
      anon_id: ANON,
      path_template: '/listing/[slug]',
      device: 'mobile',
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'fall_launch',
      referrer_host: 'chatgpt.com',
      app_version: '1.4.0',
      title_key: 'home',
    };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, device: 'watch' }).success).toBe(false);
    expect(schema.safeParse({ ...ok, utm_source: 'Jane Doe <jane@x.co>' }).success).toBe(false);
    expect(schema.safeParse({ ...ok, referrer_host: 'https://a.com/x?y=1' }).success).toBe(false);
  });

  it('accepts ui_click only for a listed element', () => {
    const base = { event: 'ui_click', surface: 'search', session_id: SESSION };
    expect(schema.safeParse({ ...base, element_id: 'filter_open' }).success).toBe(true);
    expect(schema.safeParse({ ...base, element_id: 'Buy now for Jane' }).success).toBe(false);
  });

  it('accepts a coarse map cell and rejects an exact point', () => {
    const base = { event: 'map_move', surface: 'map', session_id: SESSION };
    expect(schema.safeParse({ ...base, bbox_cell: '38.90:-77.03', zoom: 12 }).success).toBe(true);
    expect(schema.safeParse({ ...base, bbox_cell: '38.9012345:-77.0345678' }).success).toBe(false);
  });

  it('accepts home-feed events and dwell buckets', () => {
    const feed = {
      surface: 'home',
      session_id: SESSION,
      row_id: 'near_you',
      position: 2,
      listing_id: LISTING,
      variant: 'control',
      model_version: 'v1',
      explore: false,
    };
    expect(schema.safeParse({ ...feed, event: 'feed_impression' }).success).toBe(true);
    expect(schema.safeParse({ ...feed, event: 'feed_click' }).success).toBe(true);
    expect(schema.safeParse({ ...feed, event: 'feed_click', explore: 'no' }).success).toBe(false);
    for (const dwell_bucket of ['0-5', '5-30', '30-120', '120+']) {
      const dwell = { event: 'dwell', surface: 'detail', session_id: SESSION, dwell_bucket };
      expect(schema.safeParse(dwell).success).toBe(true);
    }
    const bad = { event: 'dwell', surface: 'detail', session_id: SESSION, dwell_bucket: '7' };
    expect(schema.safeParse(bad).success).toBe(false);
  });

  it('accepts src as home:{rowId}:{position} on save and lead submit only', () => {
    const base = { surface: 'detail', session_id: SESSION, listing_id: LISTING };
    for (const event of ['listing_save', 'lead_submit']) {
      expect(schema.safeParse({ ...base, event, src: 'home:near_you:3' }).success).toBe(true);
      expect(schema.safeParse({ ...base, event, src: 'somewhere else' }).success).toBe(false);
    }
    const unsave = { ...base, event: 'listing_unsave', src: 'home:near_you:3' };
    expect(schema.safeParse(unsave).success).toBe(false);
  });

  it('scrubs zero-result text and moves the other values to props', () => {
    const parsed = schema.parse({
      event: 'search_zero_result_text',
      surface: 'search',
      session_id: SESSION,
      query_text:
        '  3 bed jane@x.co call 202-555-0142 near https://x.co/a   bethesda ' + 'z'.repeat(80),
    });
    const n = normalizeAnalyticsEvent(parsed);
    expect(n.queryText).not.toMatch(/@|\d{3}-|https/);
    expect(n.queryText?.length).toBeLessThanOrEqual(60);
    const empty = {
      event: 'search_zero_result_text',
      surface: 'search',
      session_id: SESSION,
      query_text: 'a@b.co',
    };
    expect(schema.safeParse(empty).success).toBe(false);

    const m = normalizeAnalyticsEvent(
      schema.parse({
        event: 'map_move',
        surface: 'map',
        session_id: SESSION,
        anon_id: ANON,
        bbox_cell: '38.90:-77.03',
        utm_source: 'x',
        zoom: 11,
      }),
    );
    expect(m.anonId).toBe(ANON);
    expect(m.common).toEqual({ utm_source: 'x' });
    expect(m.props).toEqual({ bbox_cell: '38.90:-77.03', zoom: 11 });
  });

  it('accepts a batch of up to 50 events and no more', () => {
    const one = { event: 'page_view', surface: 'home', session_id: SESSION };
    expect(analyticsEventBatchSchema.safeParse([one, one]).success).toBe(true);
    expect(analyticsEventBatchSchema.safeParse([]).success).toBe(false);
    const big = Array.from({ length: ANALYTICS_BATCH_MAX + 1 }, () => one);
    expect(analyticsEventBatchSchema.safeParse(big).success).toBe(false);
    expect(analyticsEventBatchSchema.safeParse([one, { ...one, email: 'x' }]).success).toBe(false);
  });

  it('scrubs digits and addresses', () => {
    expect(scrubQueryText('call me 2025550142 at a@b.co')).toBe('call me at');
  });
});

describe('funnel error codes and account link (#827)', () => {
  const base = { surface: 'detail', session_id: SESSION, anon_id: ANON };

  it('accepts only fixed error codes on lead and auth events', () => {
    const lead = { ...base, event: 'lead_error' };
    const fail = { ...base, event: 'auth_fail' };
    expect(schema.safeParse({ ...lead, error_code: 'rate_limited' }).success).toBe(true);
    expect(schema.safeParse({ ...fail, error_code: 'code_invalid' }).success).toBe(true);
    expect(schema.safeParse({ ...lead, error_code: 'me@example.com' }).success).toBe(false);
    expect(schema.safeParse({ ...fail, error_code: 'free_text' }).success).toBe(false);
  });

  it('accepts a link request with the anon id only', () => {
    expect(analyticsAccountLinkRequestSchema.safeParse({ anon_id: ANON }).success).toBe(true);
    expect(
      analyticsAccountLinkRequestSchema.safeParse({ anon_id: ANON, email: 'a@b.co' }).success,
    ).toBe(false);
    expect(analyticsAccountLinkRequestSchema.safeParse({}).success).toBe(false);
  });
});
