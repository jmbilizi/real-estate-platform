'use client';

import { MapPin, MessageCircle, TrendingUp, Users } from 'lucide-react';

const MOCK_POSTS = [
  {
    id: '1',
    author: 'Sarah M.',
    avatar: 'SM',
    time: '2h ago',
    content:
      'Just closed on our first home in Old Town Alexandria! The neighborhood is amazing. Any restaurant recommendations?',
    likes: 24,
    comments: 8,
  },
  {
    id: '2',
    author: 'Marcus J.',
    avatar: 'MJ',
    time: '4h ago',
    content:
      'Market update: seeing 3 price drops in Federal Hill this week. Buyers gaining leverage!',
    likes: 45,
    comments: 12,
  },
  {
    id: '3',
    author: 'Lisa K.',
    avatar: 'LK',
    time: '6h ago',
    content:
      'Looking for a reliable contractor for kitchen remodel in Bethesda. Budget around $35k. Any referrals?',
    likes: 11,
    comments: 19,
  },
];

const TRENDING_TOPICS = [
  { label: 'Price drops in DC metro', count: 142 },
  { label: 'First-time buyer tips', count: 89 },
  { label: 'Old Town Alexandria', count: 67 },
  { label: 'Mortgage rate updates', count: 234 },
  { label: 'Home renovation ideas', count: 56 },
];

const NEIGHBORHOOD_GROUPS = [
  { name: 'Penn Quarter, DC', members: 1240 },
  { name: 'Federal Hill, Baltimore', members: 892 },
  { name: 'Old Town Alexandria', members: 2100 },
  { name: 'Bethesda, MD', members: 1650 },
];

export default function CommunityPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-surface-soft to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand mb-6">
            <Users className="h-3.5 w-3.5" />
            Coming Soon
          </span>
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            See what&apos;s happening
            <br />
            <span className="text-brand">in your neighborhood</span>
          </h1>
          <p className="mt-4 text-lg text-ink-muted max-w-2xl mx-auto">
            Connect with neighbors, local professionals, follow market trends, and get the inside
            scoop on your community.
          </p>
        </div>
      </section>

      {/* Content preview */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Feed */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-bold text-ink flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-brand" />
              Activity Feed
            </h2>
            {MOCK_POSTS.map((post) => (
              <div
                key={post.id}
                className="rounded-2xl border border-surface-border p-5 relative overflow-hidden"
              >
                {/* Blur overlay */}
                <div className="absolute inset-0 backdrop-blur-[2px] bg-white/60 z-10 flex items-center justify-center">
                  <span className="px-4 py-2 rounded-full bg-brand/10 text-brand text-sm font-medium">
                    Sign up to see posts
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand font-semibold text-sm">
                    {post.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{post.author}</span>
                      <span className="text-xs text-ink-muted">{post.time}</span>
                    </div>
                    <p className="text-sm text-ink mt-1">{post.content}</p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-ink-muted">
                      <span>♥ {post.likes}</span>
                      <span>💬 {post.comments}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Trending */}
            <div className="rounded-2xl border border-surface-border p-5">
              <h3 className="text-base font-bold text-ink flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-brand" />
                Trending
              </h3>
              <div className="space-y-3">
                {TRENDING_TOPICS.map((topic) => (
                  <div key={topic.label} className="flex items-center justify-between">
                    <span className="text-sm text-ink">{topic.label}</span>
                    <span className="text-xs text-ink-muted">{topic.count} posts</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Neighborhood Groups */}
            <div className="rounded-2xl border border-surface-border p-5">
              <h3 className="text-base font-bold text-ink flex items-center gap-2 mb-4">
                <MapPin className="h-4 w-4 text-brand" />
                Neighborhood Groups
              </h3>
              <div className="space-y-3">
                {NEIGHBORHOOD_GROUPS.map((group) => (
                  <div key={group.name} className="flex items-center justify-between">
                    <span className="text-sm text-ink">{group.name}</span>
                    <span className="text-xs text-ink-muted">
                      {group.members.toLocaleString()} members
                    </span>
                  </div>
                ))}
              </div>
              <button
                className="mt-4 w-full py-2.5 rounded-xl border border-brand text-brand text-sm font-medium hover:bg-brand/5 transition-colors"
                disabled
              >
                Browse All Groups
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-surface-border bg-surface-soft">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h2 className="text-2xl font-bold text-ink mb-3">Be the first to know</h2>
          <p className="text-ink-muted mb-6">
            Get early access to CribStop Community — follow neighbors, share insights, and stay
            connected to your local real estate market.
          </p>
          <button className="btn-primary" disabled>
            Join the Waitlist
          </button>
        </div>
      </section>
    </div>
  );
}
