'use client';

import { useAppSelector } from '@/lib/store/hooks';
import { selectShowOnboarding } from '@/lib/store/selectors';
import OnboardingModal from './OnboardingModal';

export default function OnboardingListener() {
  const showOnboarding = useAppSelector(selectShowOnboarding);

  if (!showOnboarding) return null;

  return <OnboardingModal open={showOnboarding} />;
}
