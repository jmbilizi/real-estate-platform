import { reportMapMove } from './map-move-event';

const mockTrackEvent = jest.fn();
jest.mock('./analytics', () => ({ trackEvent: (...a: unknown[]) => mockTrackEvent(...a) }));

describe('reportMapMove (#826)', () => {
  beforeEach(() => mockTrackEvent.mockReset());

  it('sends a 2-decimal cell of the view centre and never the view edges', () => {
    const zoom = reportMapMove(
      { west: -77.1234, south: 38.8001, east: -77.0, north: 38.9, zoom: 12.4 },
      12,
    );
    expect(zoom).toBe(12);
    const [name, options] = mockTrackEvent.mock.calls[0];
    expect(name).toBe('map_move');
    expect(options.surface).toBe('map');
    expect(options.props).toEqual({ zoom: 12, bbox_cell: '38.85:-77.06', trigger: 'pan' });
    expect(JSON.stringify(options)).not.toMatch(/77\.1234|38\.8001/);
  });

  it('reports a zoom change', () => {
    reportMapMove({ west: 0, south: 0, east: 1, north: 1, zoom: 14 }, 12);
    expect(mockTrackEvent.mock.calls[0][1].props.trigger).toBe('zoom');
  });
});
