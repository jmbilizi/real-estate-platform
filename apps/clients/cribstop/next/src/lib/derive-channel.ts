/**
 * Derives acquisition channel from utm parameters and referrer host (#830).
 *
 * Pure function. No side effects. Logs nothing.
 */

export type AcquisitionChannel =
  | 'direct'
  | 'organic_search'
  | 'paid'
  | 'email'
  | 'social'
  | 'referral'
  | 'ai_assistant';

export interface ChannelDerivationInput {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer_host?: string;
}

/** AI assistant domains that refer traffic. */
const AI_ASSISTANT_HOSTS = new Set([
  'chatgpt.com',
  'perplexity.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
  'claude.ai',
]);

/** Known search engine hosts. */
const SEARCH_HOSTS = new Set([
  'google.com',
  'bing.com',
  'yahoo.com',
  'duckduckgo.com',
  'baidu.com',
  'yandex.com',
]);

/** Known social media hosts. */
const SOCIAL_HOSTS = new Set([
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'linkedin.com',
  'reddit.com',
  'tiktok.com',
  'nextdoor.com',
  'pinterest.com',
]);

/** Known social media utm_source values. */
const SOCIAL_SOURCES = new Set([
  'facebook',
  'twitter',
  'x',
  'instagram',
  'linkedin',
  'reddit',
  'tiktok',
  'pinterest',
  'nextdoor',
]);

/** Known search engine utm_source values. */
const SEARCH_SOURCES = new Set(['google', 'bing', 'yahoo', 'duckduckgo', 'baidu', 'yandex']);

/**
 * Extract the primary domain from a hostname. Handles subdomains.
 * Examples: "www.google.com" → "google.com", "www.chatgpt.com" → "chatgpt.com"
 */
function primaryDomain(hostname: string): string {
  const parts = hostname.split('.').reverse();
  if (parts.length >= 2) {
    // Return last two parts (e.g. google.com)
    return parts.slice(0, 2).reverse().join('.');
  }
  return hostname;
}

/**
 * Check if a hostname belongs to a given domain, handling subdomains.
 * Examples: "www.chatgpt.com" matches "chatgpt.com", but "notchatgpt.com" does not.
 */
function hostnameMatches(hostname: string, domain: string): boolean {
  if (!hostname) return false;
  return hostname === domain || hostname.endsWith('.' + domain);
}

/**
 * Derives acquisition channel from UTM parameters and referrer host.
 *
 * Priority order:
 * 1. AI assistant referrer hosts (highest priority)
 * 2. utm_medium: paid (cpc/ppc/paid), email
 * 3. Referrer host: search, social, known hosts
 * 4. utm_source: search, social
 * 5. Default: direct (no referrer + no utm) or referral (unknown referrer)
 */
export function deriveChannel(input: ChannelDerivationInput): AcquisitionChannel {
  const { utm_source = '', utm_medium = '', utm_campaign = '', referrer_host = '' } = input;

  // Check AI assistants first (highest priority when present)
  if (referrer_host) {
    for (const assistantDomain of AI_ASSISTANT_HOSTS) {
      if (hostnameMatches(referrer_host, assistantDomain)) {
        return 'ai_assistant';
      }
    }
  }

  // Check utm_medium for paid and email (next priority)
  if (utm_medium === 'cpc' || utm_medium === 'ppc' || utm_medium === 'paid') {
    return 'paid';
  }
  if (utm_medium === 'email') {
    return 'email';
  }

  // Check referrer_host for known sources
  if (referrer_host) {
    for (const searchHost of SEARCH_HOSTS) {
      if (hostnameMatches(referrer_host, searchHost)) {
        return 'organic_search';
      }
    }

    for (const socialHost of SOCIAL_HOSTS) {
      if (hostnameMatches(referrer_host, socialHost)) {
        return 'social';
      }
    }

    // Unknown referrer is a referral
    return 'referral';
  }

  // Check utm_source if no referrer_host
  const normalizedSource = utm_source.toLowerCase();
  if (SEARCH_SOURCES.has(normalizedSource)) {
    return 'organic_search';
  }
  if (SOCIAL_SOURCES.has(normalizedSource)) {
    return 'social';
  }

  // No utm_source or referrer: direct (if utm_campaign is present, still treat as direct)
  if (utm_source || utm_medium || utm_campaign) {
    return 'direct';
  }

  // Truly no utm and no referrer
  return 'direct';
}
