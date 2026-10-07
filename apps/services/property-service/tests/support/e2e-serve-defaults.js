// Preloaded into the process that `nx serve` starts, which the `e2e` target depends on.
// The inquiries suite posts more times from one IP than the default per-IP limit (5) allows.
// `??=` keeps any limit the caller sets.
process.env.INQUIRY_RATE_LIMIT_PER_IP_MAX ??= '1000';
process.env.INQUIRY_RATE_LIMIT_PER_LISTING_MAX ??= '1000';
// The contacts stub shares the introspection stub's port (tests/support/introspection-stub.ts).
process.env.ACCOUNT_SERVICE_CONTACTS_URL ??=
  `http://localhost:${process.env.PROPERTY_SERVICE_E2E_INTROSPECT_PORT ?? 3902}` +
  '/internal/account/contacts';
