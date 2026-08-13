import { render, screen } from '@testing-library/react';
import SingleListingMap from './SingleListingMap';

// The pin itself is real react-leaflet, which needs a browser environment this suite doesn't
// stand up. The guard under test here — whether the pin-bearing component is ever mounted at
// all — lives entirely in SingleListingMap, so a stub is enough to observe it.
jest.mock('next/dynamic', () => () => {
  return function MockInner(props: { latitude: number; longitude: number }) {
    return <div data-testid="map-pin" data-lat={props.latitude} data-lng={props.longitude} />;
  };
});

describe('SingleListingMap', () => {
  it('renders a pin when both coordinates are present', () => {
    render(
      <SingleListingMap
        latitude={38.9847}
        longitude={-77.0947}
        price={750000}
        listingType="sale"
      />,
    );

    const pin = screen.getByTestId('map-pin');
    expect(pin.getAttribute('data-lat')).toBe('38.9847');
    expect(pin.getAttribute('data-lng')).toBe('-77.0947');
  });

  it('renders no pin — and no fallback centroid — for a suppressed address', () => {
    render(<SingleListingMap latitude={null} longitude={null} price={750000} listingType="sale" />);

    expect(screen.queryByTestId('map-pin')).toBeNull();
    expect(screen.getByText(/not shown at the seller/i)).toBeInTheDocument();
  });

  it('renders no pin when only one coordinate is present', () => {
    render(
      <SingleListingMap latitude={38.9847} longitude={null} price={750000} listingType="sale" />,
    );

    expect(screen.queryByTestId('map-pin')).toBeNull();
  });
});
