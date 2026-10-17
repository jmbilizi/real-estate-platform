/**
 * The popup is its own React root. This spec renders the real `MapPinCard` through it, so a missing
 * provider shows as an empty popup (#930). `PricePinLayer.spec.tsx` mocks the card and cannot see it.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import L from 'leaflet';
import type { MapPin } from '@cribstop/property-contracts';

let mockMap: L.Map;
jest.mock('react-leaflet', () => ({ useMap: () => mockMap }));
jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/lib/api/listings', () => {
  const actual = jest.requireActual('@/lib/api/listings');
  return { ...actual, getListingCard: jest.fn() };
});

import PricePinLayer from './PricePinLayer';
import { getListingCard } from '@/lib/api/listings';
import { aListingCardRow } from '@/test/fixtures';

const CENTER: [number, number] = [38.9, -77.03];
const ADDRESS = '100 Test St, Bethesda, MD 20814';
const pin: MapPin = {
  id: 'off-page',
  latitude: CENTER[0],
  longitude: CENTER[1],
  price: 585_000,
  status: 'Active',
  listingType: 'sale',
};

let host: HTMLDivElement;

beforeEach(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(
      () =>
        new Proxy(
          {},
          { get: () => () => undefined, set: () => true },
        ) as unknown as CanvasRenderingContext2D,
    );
  host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  mockMap = L.map(host, { center: CENTER, zoom: 15 });
  (getListingCard as jest.Mock).mockResolvedValue(aListingCardRow({ id: 'off-page' }));
});

afterEach(() => {
  cleanup();
  mockMap.remove();
  host.remove();
  jest.restoreAllMocks();
});

it('shows the card in the popup after a click on a pin off the results page', async () => {
  render(<PricePinLayer pins={[pin]} rowsById={new Map()} activeId={null} />);
  let target: (L.CircleMarker & { pin: MapPin }) | undefined;
  mockMap.eachLayer((layer) => {
    if ('pin' in layer && 'label' in layer) target = layer as L.CircleMarker & { pin: MapPin };
  });

  await act(async () => {
    target?.fire('click', {}, true);
  });

  expect(await screen.findByText(ADDRESS)).toBeInTheDocument();
});
