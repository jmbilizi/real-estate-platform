import { render } from '@testing-library/react';
import { SkeletonBar, SkeletonBlock, SkeletonText } from './Skeleton';

describe('SkeletonBar', () => {
  it('renders a hidden placeholder with the shared fill token', () => {
    const { container } = render(<SkeletonBar className="w-20" />);
    const fill = container.querySelector('.skeleton-fill');

    expect(fill).not.toBeNull();
    expect(fill).toHaveClass('bg-surface-soft');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('SkeletonBlock', () => {
  it('renders a hidden shape placeholder with the given box', () => {
    const { container } = render(<SkeletonBlock className="h-5 w-5 rounded-full" />);
    const block = container.firstChild as HTMLElement;

    expect(block).toHaveClass('skeleton-fill', 'bg-surface-soft', 'h-5', 'w-5', 'rounded-full');
    expect(block).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('SkeletonText', () => {
  it('draws the placeholder while loading, without the real content', () => {
    const { container, queryByText } = render(
      <SkeletonText loading width="w-16">
        Real Broker, LLC
      </SkeletonText>,
    );

    expect(container.querySelector('.skeleton-fill')).not.toBeNull();
    expect(queryByText('Real Broker, LLC')).toBeNull();
  });

  it('resolves to the real content once loading is false', () => {
    const { container, getByText } = render(
      <SkeletonText loading={false} width="w-16">
        Real Broker, LLC
      </SkeletonText>,
    );

    expect(container.querySelector('.skeleton-fill')).toBeNull();
    expect(getByText('Real Broker, LLC')).toBeInTheDocument();
  });
});
