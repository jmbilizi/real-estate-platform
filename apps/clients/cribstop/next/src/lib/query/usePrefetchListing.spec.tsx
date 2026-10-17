import { fireEvent, render, screen } from '@testing-library/react';
import { getListing } from '@/lib/api/listings';
import { usePrefetchListing } from './usePrefetchListing';

jest.mock('@/lib/api/listings', () => ({
  ...jest.requireActual('@/lib/api/listings'),
  getListing: jest.fn(),
}));

const mockedGetListing = getListing as jest.Mock;

function Card({ id }: { id: string }) {
  const handlers = usePrefetchListing(id);
  return (
    <div data-testid="card" tabIndex={0} {...handlers}>
      card
    </div>
  );
}

describe('usePrefetchListing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedGetListing.mockReset();
    mockedGetListing.mockReturnValue(new Promise(() => undefined));
  });
  afterEach(() => jest.useRealTimers());

  it('prefetches the detail after the focus rests on the card', () => {
    render(<Card id="prefetch-a" />);
    fireEvent.focus(screen.getByTestId('card'));
    expect(mockedGetListing).not.toHaveBeenCalled();
    jest.advanceTimersByTime(150);
    expect(mockedGetListing).toHaveBeenCalledWith('prefetch-a', expect.anything());
  });

  it('skips a focus that leaves before the delay', () => {
    render(<Card id="prefetch-b" />);
    fireEvent.focus(screen.getByTestId('card'));
    fireEvent.blur(screen.getByTestId('card'));
    jest.advanceTimersByTime(300);
    expect(mockedGetListing).not.toHaveBeenCalled();
  });
});
