/** Leaflet does not run under jsdom, so these stand-ins record markers and fire their handlers. */
type Handler = () => void;
interface FakeMarker {
  latlng: [number, number];
  options: { title?: string };
  el: HTMLElement;
  fire: (e: string) => void;
}
const created: FakeMarker[] = [];
const mockMap = {
  on: jest.fn(),
  off: jest.fn(),
  removeLayer: jest.fn(),
  latLngToContainerPoint: (ll: [number, number]) => ({
    x: (ll[1] + 77) * 10000,
    y: (ll[0] - 38) * 10000,
  }),
};

jest.mock('react-leaflet', () => ({ useMap: () => mockMap }));
jest.mock('leaflet', () => ({
  __esModule: true,
  default: {
    divIcon: (o: { html: string }) => o,
    layerGroup: () => ({ addLayer: jest.fn(), addTo: jest.fn() }),
    marker: (latlng: [number, number], options: { title?: string }) => {
      const handlers: Record<string, Handler[]> = {};
      const el = document.createElement('div');
      el.innerHTML =
        (options as { icon?: { html: string } }).icon?.html ?? '<span><span></span></span>';
      const m = {
        latlng,
        options,
        el,
        on: (e: string, h: Handler) => {
          (handlers[e] ??= []).push(h);
          return m;
        },
        fire: (e: string) => handlers[e]?.forEach((h) => h()),
        getElement: () => el,
        setZIndexOffset: jest.fn(),
      };
      created.push(m);
      return m;
    },
  },
}));

import { render } from '@testing-library/react';
import NeighborhoodMapLayer, {
  layoutNeighborhoodMarkers,
  neighborhoodMarkerLabel,
  selectMappableNeighborhoods,
} from './NeighborhoodMapLayer';

const row = (name: string, centroid: { lat: number; lng: number } | null, total = 42) => ({
  key: `md|bethesda|${name.toLowerCase()}`,
  name,
  city: 'Bethesda',
  state: 'MD',
  slug: name.toLowerCase(),
  total,
  sale: total,
  rent: 0,
  centroid,
  bounds: null,
});

const setTouch = (coarse: boolean) => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: coarse }) as never;
};

beforeEach(() => {
  created.length = 0;
  setTouch(false);
});

describe('selectMappableNeighborhoods', () => {
  it('drops a row with a null centroid and keeps a 0,0 centroid', () => {
    const rows = [
      row('Shaw', { lat: 38.9, lng: -77 }),
      row('Nowhere', null),
      row('Zero', { lat: 0, lng: 0 }),
    ];
    expect(selectMappableNeighborhoods(rows).map((r) => r.name)).toEqual(['Shaw', 'Zero']);
  });
});

describe('layoutNeighborhoodMarkers', () => {
  const item = (key: string, total: number, x: number, y: number) => ({
    key,
    name: key,
    total,
    x,
    y,
  });

  it('keeps every marker full when none overlap', () => {
    const modes = layoutNeighborhoodMarkers([item('a', 5, 0, 0), item('b', 9, 500, 500)], false);
    expect([...modes.values()]).toEqual(['full', 'full']);
  });

  it('keeps the higher count full and shrinks the overlapping lower count', () => {
    const modes = layoutNeighborhoodMarkers([item('low', 5, 10, 0), item('high', 90, 0, 0)], false);
    expect(modes.get('high')).toBe('full');
    expect(modes.get('low')).not.toBe('full');
  });

  it('falls back to a dot when even a bubble would overlap', () => {
    const modes = layoutNeighborhoodMarkers(
      [item('a', 30, 0, 0), item('b', 20, 1, 0), item('c', 10, 2, 0)],
      false,
    );
    expect(modes.get('a')).toBe('full');
    expect(modes.get('c')).toBe('dot');
  });

  it('orders by count, so the result does not depend on input order', () => {
    const a = layoutNeighborhoodMarkers([item('x', 5, 0, 0), item('y', 50, 5, 0)], false);
    const b = layoutNeighborhoodMarkers([item('y', 50, 5, 0), item('x', 5, 0, 0)], false);
    expect(a.get('y')).toBe(b.get('y'));
    expect(a.get('x')).toBe(b.get('x'));
  });

  it('starts at the count bubble in compact mode', () => {
    const modes = layoutNeighborhoodMarkers([item('a', 5, 0, 0), item('b', 9, 500, 500)], true);
    expect([...modes.values()]).toEqual(['bubble', 'bubble']);
  });
});

describe('neighborhoodMarkerLabel', () => {
  it('shows the name and the count only', () => {
    expect(neighborhoodMarkerLabel('Shaw', 42)).toBe('Shaw · 42');
    expect(neighborhoodMarkerLabel('Shaw', 1234)).toBe('Shaw · 1,234');
  });
  it('cuts a long name', () => {
    expect(neighborhoodMarkerLabel('A Very Long Neighborhood Name', 5)).toMatch(/^.{1,18}… · 5$/);
  });
});

describe('NeighborhoodMapLayer', () => {
  const rows = selectMappableNeighborhoods([
    row('Shaw', { lat: 38.91, lng: -77.02 }),
    row('Nowhere', null),
  ]);
  const setup = (active: string | null = null) => {
    const props = { onActive: jest.fn(), onSelect: jest.fn(), onTapPreview: jest.fn() };
    render(<NeighborhoodMapLayer rows={rows} activeKey={active} {...props} />);
    return props;
  };

  it('renders one marker per mappable row at its centroid', () => {
    setup();
    expect(created).toHaveLength(1);
    expect(created[0].latlng).toEqual([38.91, -77.02]);
  });

  const pillText = () =>
    (created[0].el.firstElementChild!.firstElementChild as HTMLElement).textContent;

  it('draws the name and count from sm up', () => {
    setup();
    expect(pillText()).toBe('Shaw · 42');
  });

  it('draws a count bubble with no name below sm, and the name when highlighted', () => {
    const width = window.innerWidth;
    window.innerWidth = 360;
    try {
      const props = { onActive: jest.fn(), onSelect: jest.fn() };
      const { rerender } = render(<NeighborhoodMapLayer rows={rows} activeKey={null} {...props} />);
      expect(pillText()).toBe('42');
      rerender(<NeighborhoodMapLayer rows={rows} activeKey={rows[0].key} {...props} />);
      expect(pillText()).toBe('Shaw · 42');
      rerender(<NeighborhoodMapLayer rows={rows} activeKey={null} {...props} />);
      expect(pillText()).toBe('42');
    } finally {
      window.innerWidth = width;
    }
  });

  it('keeps the 44px tap box in every mode', () => {
    setup();
    const box = created[0].el.firstElementChild as HTMLElement;
    expect(box.style.width).toBe('44px');
    expect(box.style.height).toBe('44px');
  });

  it('reports the key on hover and clears it on mouseout', () => {
    const { onActive } = setup();
    created[0].fire('mouseover');
    expect(onActive).toHaveBeenLastCalledWith(rows[0].key);
    created[0].fire('mouseout');
    expect(onActive).toHaveBeenLastCalledWith(null);
  });

  it('highlights the active marker in place', () => {
    const props = { onActive: jest.fn(), onSelect: jest.fn() };
    const { rerender } = render(<NeighborhoodMapLayer rows={rows} activeKey={null} {...props} />);
    const pill = created[0].el.firstElementChild!.firstElementChild as HTMLElement;
    rerender(<NeighborhoodMapLayer rows={rows} activeKey={rows[0].key} {...props} />);
    expect(pill.style.background).toBe('rgb(255, 56, 92)');
    rerender(<NeighborhoodMapLayer rows={rows} activeKey={null} {...props} />);
    expect(pill.style.background).toBe('rgb(255, 255, 255)');
    expect(created).toHaveLength(1);
  });

  it('drills down on a click with a mouse', () => {
    const { onSelect } = setup();
    created[0].fire('click');
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
  });

  it('previews on the first tap and drills on a tap of the active marker', () => {
    setTouch(true);
    const first = setup();
    created[0].fire('click');
    expect(first.onTapPreview).toHaveBeenCalledWith(rows[0].key);
    expect(first.onActive).toHaveBeenCalledWith(rows[0].key);
    expect(first.onSelect).not.toHaveBeenCalled();

    created.length = 0;
    const second = setup(rows[0].key);
    created[0].fire('click');
    expect(second.onSelect).toHaveBeenCalledWith(rows[0]);
  });
});
