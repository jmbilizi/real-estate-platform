import { deriveChannel } from './derive-channel';

describe('deriveChannel()', () => {
  it('maps chatgpt.com to ai_assistant', () => {
    expect(deriveChannel({ referrer_host: 'chatgpt.com' })).toBe('ai_assistant');
  });

  it('maps www.chatgpt.com to ai_assistant', () => {
    expect(deriveChannel({ referrer_host: 'www.chatgpt.com' })).toBe('ai_assistant');
  });

  it('rejects notchatgpt.com as ai_assistant', () => {
    expect(deriveChannel({ referrer_host: 'notchatgpt.com' })).not.toBe('ai_assistant');
  });

  it('maps perplexity.ai to ai_assistant', () => {
    expect(deriveChannel({ referrer_host: 'perplexity.ai' })).toBe('ai_assistant');
  });

  it('maps www.perplexity.ai to ai_assistant', () => {
    expect(deriveChannel({ referrer_host: 'www.perplexity.ai' })).toBe('ai_assistant');
  });

  it('maps gemini.google.com to ai_assistant', () => {
    expect(deriveChannel({ referrer_host: 'gemini.google.com' })).toBe('ai_assistant');
  });

  it('maps copilot.microsoft.com to ai_assistant', () => {
    expect(deriveChannel({ referrer_host: 'copilot.microsoft.com' })).toBe('ai_assistant');
  });

  it('maps claude.ai to ai_assistant', () => {
    expect(deriveChannel({ referrer_host: 'claude.ai' })).toBe('ai_assistant');
  });

  it('maps www.claude.ai to ai_assistant', () => {
    expect(deriveChannel({ referrer_host: 'www.claude.ai' })).toBe('ai_assistant');
  });

  it('maps utm_medium cpc to paid', () => {
    expect(deriveChannel({ utm_medium: 'cpc' })).toBe('paid');
  });

  it('maps utm_medium ppc to paid', () => {
    expect(deriveChannel({ utm_medium: 'ppc' })).toBe('paid');
  });

  it('maps utm_medium paid to paid', () => {
    expect(deriveChannel({ utm_medium: 'paid' })).toBe('paid');
  });

  it('maps utm_medium email to email', () => {
    expect(deriveChannel({ utm_medium: 'email' })).toBe('email');
  });

  it('maps facebook.com to social', () => {
    expect(deriveChannel({ referrer_host: 'facebook.com' })).toBe('social');
  });

  it('maps twitter.com to social', () => {
    expect(deriveChannel({ referrer_host: 'twitter.com' })).toBe('social');
  });

  it('maps instagram.com to social', () => {
    expect(deriveChannel({ referrer_host: 'instagram.com' })).toBe('social');
  });

  it('maps linkedin.com to social', () => {
    expect(deriveChannel({ referrer_host: 'linkedin.com' })).toBe('social');
  });

  it('maps reddit.com to social', () => {
    expect(deriveChannel({ referrer_host: 'reddit.com' })).toBe('social');
  });

  it('maps tiktok.com to social', () => {
    expect(deriveChannel({ referrer_host: 'tiktok.com' })).toBe('social');
  });

  it('maps www.facebook.com to social', () => {
    expect(deriveChannel({ referrer_host: 'www.facebook.com' })).toBe('social');
  });

  it('maps google.com to organic_search', () => {
    expect(deriveChannel({ referrer_host: 'google.com' })).toBe('organic_search');
  });

  it('maps www.google.com to organic_search', () => {
    expect(deriveChannel({ referrer_host: 'www.google.com' })).toBe('organic_search');
  });

  it('maps bing.com to organic_search', () => {
    expect(deriveChannel({ referrer_host: 'bing.com' })).toBe('organic_search');
  });

  it('maps yahoo.com to organic_search', () => {
    expect(deriveChannel({ referrer_host: 'yahoo.com' })).toBe('organic_search');
  });

  it('maps duckduckgo.com to organic_search', () => {
    expect(deriveChannel({ referrer_host: 'duckduckgo.com' })).toBe('organic_search');
  });

  it('returns direct with no referrer and no utm', () => {
    expect(deriveChannel({})).toBe('direct');
  });

  it('returns referral for unknown referrer_host', () => {
    expect(deriveChannel({ referrer_host: 'unknown-site.com' })).toBe('referral');
  });

  it('prioritizes ai_assistant over other referrals', () => {
    expect(deriveChannel({ referrer_host: 'chatgpt.com', utm_medium: 'referral' })).toBe(
      'ai_assistant',
    );
  });

  it('prioritizes utm_medium paid over referrer', () => {
    expect(deriveChannel({ referrer_host: 'unknown-site.com', utm_medium: 'cpc' })).toBe('paid');
  });

  it('prioritizes utm_medium email over referrer', () => {
    expect(deriveChannel({ referrer_host: 'unknown-site.com', utm_medium: 'email' })).toBe('email');
  });

  it('uses utm_source if utm_medium is missing', () => {
    expect(deriveChannel({ utm_source: 'google', utm_medium: '' })).toBe('organic_search');
  });

  it('maps google utm_source to organic_search', () => {
    expect(deriveChannel({ utm_source: 'google' })).toBe('organic_search');
  });

  it('maps facebook utm_source to social', () => {
    expect(deriveChannel({ utm_source: 'facebook' })).toBe('social');
  });

  it('returns direct when utm has no matching source', () => {
    expect(deriveChannel({ utm_source: 'unknown', utm_campaign: 'summer_sale' })).toBe('direct');
  });

  it('ignores utm fields when referrer is ai_assistant', () => {
    expect(
      deriveChannel({
        referrer_host: 'chatgpt.com',
        utm_source: 'google',
        utm_medium: 'organic',
        utm_campaign: 'test',
      }),
    ).toBe('ai_assistant');
  });
});
