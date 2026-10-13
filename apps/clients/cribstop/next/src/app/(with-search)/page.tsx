import ScrollSentinel from '@/components/ScrollSentinel';
import HomePageContent from '@/components/HomePageContent';
import { parseHomeFeedFlags } from '@/lib/home-feed';

// The home feed flags are runtime env vars, so the page reads them per request (#836).
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <>
      <ScrollSentinel />
      <HomePageContent
        homeFeed={parseHomeFeedFlags({
          HOME_FEED_ENABLED: process.env.HOME_FEED_ENABLED,
          HOME_FEED_ROLLOUT_PCT: process.env.HOME_FEED_ROLLOUT_PCT,
        })}
      />
    </>
  );
}
