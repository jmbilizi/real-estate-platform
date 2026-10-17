import { useQuery } from '@tanstack/react-query';
import { aListingDetail } from '@/test/fixtures';
import { getListing, toListingDetailView } from '@/lib/api/listings';
import { renderWithClient } from '@/test/renderWithClient';
import HydratedListing from './HydratedListing';
import { listingDetailOptions } from './listings';

jest.mock('@/lib/api/listings', () => ({
  ...jest.requireActual('@/lib/api/listings'),
  getListing: jest.fn(),
}));

function Probe({ id }: { id: string }) {
  const query = useQuery(listingDetailOptions(id));
  return <p data-testid="probe">{query.data ? query.data.title : 'empty'}</p>;
}

describe('HydratedListing', () => {
  it('seeds the detail query so the client reads it with no request', () => {
    const view = toListingDetailView(aListingDetail());
    const { getByTestId } = renderWithClient(
      <HydratedListing listing={view}>
        <Probe id={view.id} />
      </HydratedListing>,
    );

    expect(getByTestId('probe')).toHaveTextContent(view.title);
    expect(getListing).not.toHaveBeenCalled();
  });
});
