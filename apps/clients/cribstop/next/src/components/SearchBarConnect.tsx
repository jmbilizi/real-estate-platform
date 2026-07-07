'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SearchBarConnect({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    router.push(`/connect?${params.toString()}`);
    onDone?.();
  };

  return (
    <div className="relative w-full max-w-[480px] mx-auto">
      <form
        onSubmit={handleSearch}
        className="flex items-center rounded-full border border-surface-border bg-surface-alt shadow-sm hover:shadow-md transition-shadow"
      >
        <div className="flex-1 min-w-0 px-5 py-3.5">
          <p className="text-[11px] font-semibold text-ink leading-none mb-0.5">Search</p>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="People, topics, neighborhoods..."
            className="w-full text-sm text-ink placeholder:text-ink-muted bg-transparent focus:outline-none"
          />
        </div>

        {/* Search button */}
        <button
          type="submit"
          className="flex-shrink-0 m-2 flex items-center justify-center h-10 w-10 rounded-full bg-brand text-white hover:bg-brand-700 transition-colors shadow-md"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
