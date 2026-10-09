// Preloaded into the process that `nx serve` starts, which the `e2e` target depends on.
// `??=` keeps any value the caller sets.
// The inquiries suite posts more times from one IP than the default per-IP limit (5) allows.
process.env.INQUIRY_RATE_LIMIT_PER_IP_MAX ??= '1000';
process.env.INQUIRY_RATE_LIMIT_PER_LISTING_MAX ??= '1000';

// Every account-service URL the app reads points at tests/support/introspection-stub.ts.
// The role check derives its origin from the introspect URL (src/app.ts).
// src/e2e-serve-defaults.spec.ts fails if the app reads a URL that this file omits.
const stub = `http://localhost:${process.env.PROPERTY_SERVICE_E2E_INTROSPECT_PORT ?? 3902}`;
process.env.ACCOUNT_SERVICE_INTROSPECT_URL ??= `${stub}/internal/account/introspect`;
process.env.ACCOUNT_SERVICE_CONTACTS_URL ??= `${stub}/internal/account/contacts`;
