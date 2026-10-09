import { render, screen } from '@testing-library/react';
import MapErrorBoundary from './MapErrorBoundary';

function Boom(): never {
  throw new Error('map exploded');
}

describe('MapErrorBoundary', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('renders children when nothing fails', () => {
    render(
      <MapErrorBoundary>
        <p>map</p>
      </MapErrorBoundary>,
    );
    expect(screen.getByText('map')).toBeTruthy();
  });

  it('shows the Map unavailable panel and keeps siblings alive', () => {
    render(
      <div>
        <p>results</p>
        <MapErrorBoundary>
          <Boom />
        </MapErrorBoundary>
      </div>,
    );
    expect(screen.getByText('Map unavailable')).toBeTruthy();
    expect(screen.getByText('results')).toBeTruthy();
  });
});
