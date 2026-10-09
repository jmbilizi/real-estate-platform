// maplibre-gl needs WebGL. This stub throws on construction, as it does without WebGL2.
jest.mock('maplibre-gl', () => ({
  Map: function () {
    throw new Error('GPUInitializationError: WebGL2 is required to display this map');
  },
}));

import L from 'leaflet';
import { SafeMaplibreGL } from './safe-maplibre-layer';

function leafletMap() {
  const el = document.createElement('div');
  el.style.width = '300px';
  el.style.height = '300px';
  document.body.appendChild(el);
  return L.map(el, { center: [38.9, -77], zoom: 11, zoomAnimation: false });
}

describe('SafeMaplibreGL', () => {
  it('leaves no uncaught error after a failed add, a removal and a zoom', () => {
    const map = leafletMap();
    const layer = new SafeMaplibreGL({ style: 'x' });

    expect(() => layer.addTo(map)).toThrow('WebGL2 is required');
    expect(() => map.removeLayer(layer)).not.toThrow();
    expect(() => map.setZoom(12, { animate: false })).not.toThrow();
  });

  it('keeps zoom handlers quiet while the failed layer is still attached', () => {
    const map = leafletMap();
    const layer = new SafeMaplibreGL({ style: 'x' });
    expect(() => layer.addTo(map)).toThrow();
    expect(() => map.setZoom(13, { animate: false })).not.toThrow();
    expect(() => map.remove()).not.toThrow();
  });
});
