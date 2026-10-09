// No Babel hoist here, so every `jest.mock` must come before the imports it affects.
const mockMap = { removeLayer: jest.fn() };
const mockCtor = jest.fn();
jest.mock('react-leaflet', () => ({
  TileLayer: (props: { url: string; attribution: string }) => (
    <div data-testid="raster" data-url={props.url} data-attribution={props.attribution} />
  ),
  useMap: () => mockMap,
}));
jest.mock('@/components/maplibre-worker', () => ({}));
jest.mock('@/components/safe-maplibre-layer', () => ({
  SafeMaplibreGL: function (opts: unknown) {
    return mockCtor(opts);
  },
}));

import { render, screen } from '@testing-library/react';
import BasemapLayer from './BasemapLayer';
import { MAPTILER_TILE_URL_TEMPLATE, OPENFREEMAP_CONFIG, OSM_TILE_URL } from '@/lib/map-providers';
import { resetWebGL2CacheForTests } from '@/lib/webgl2';

function webgl2(available: boolean) {
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation((() => (available ? {} : null)) as never);
}

function glLayer() {
  return {
    addTo: jest.fn(),
    getMaplibreMap: () => ({ on: jest.fn(), off: jest.fn() }),
  };
}

beforeEach(() => {
  mockMap.removeLayer.mockReset();
  mockCtor.mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
  resetWebGL2CacheForTests();
});

describe('BasemapLayer', () => {
  it('renders nothing without a config', () => {
    const { container } = render(<BasemapLayer config={null} onTileError={jest.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('uses the vector layer when WebGL2 works', () => {
    webgl2(true);
    const layer = glLayer();
    mockCtor.mockReturnValue(layer);
    render(<BasemapLayer config={OPENFREEMAP_CONFIG} onTileError={jest.fn()} />);
    expect(layer.addTo).toHaveBeenCalledWith(mockMap);
    expect(screen.queryByTestId('raster')).toBeNull();
  });

  it('draws OSM raster tiles without creating a GL layer when WebGL2 is missing', () => {
    webgl2(false);
    render(<BasemapLayer config={OPENFREEMAP_CONFIG} onTileError={jest.fn()} />);
    expect(mockCtor).not.toHaveBeenCalled();
    expect(screen.getByTestId('raster').getAttribute('data-url')).toBe(OSM_TILE_URL);
    expect(screen.getByTestId('raster').getAttribute('data-attribution')).toContain(
      'OpenStreetMap',
    );
  });

  it('keeps MapTiler raster as the basemap when a key exists', () => {
    webgl2(false);
    render(
      <BasemapLayer
        config={{
          provider: 'maptiler',
          tileUrl: `${MAPTILER_TILE_URL_TEMPLATE}?key=k`,
          attribution: 'x',
        }}
        onTileError={jest.fn()}
      />,
    );
    expect(screen.getByTestId('raster').getAttribute('data-url')).toContain('maptiler');
  });

  it('falls back to raster and cleans up when the GL add throws', () => {
    webgl2(true);
    const layer = glLayer();
    layer.addTo.mockImplementation(() => {
      throw new Error('GPUInitializationError: WebGL2 is required to display this map');
    });
    mockCtor.mockReturnValue(layer);
    expect(() =>
      render(<BasemapLayer config={OPENFREEMAP_CONFIG} onTileError={jest.fn()} />),
    ).not.toThrow();
    expect(screen.getByTestId('raster').getAttribute('data-url')).toBe(OSM_TILE_URL);
    // The one removal unregisters the events Leaflet attached. It is safe: see safe-maplibre-layer.
    expect(mockMap.removeLayer).toHaveBeenCalledTimes(1);
  });

  it('does not remove a failed layer a second time on unmount', () => {
    webgl2(true);
    const layer = glLayer();
    layer.addTo.mockImplementation(() => {
      throw new Error('fail');
    });
    mockCtor.mockReturnValue(layer);
    const { unmount } = render(
      <BasemapLayer config={OPENFREEMAP_CONFIG} onTileError={jest.fn()} />,
    );
    mockMap.removeLayer.mockClear();
    unmount();
    expect(mockMap.removeLayer).not.toHaveBeenCalled();
  });
});
