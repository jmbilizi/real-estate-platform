import L from 'leaflet';
import { MaplibreGL } from '@maplibre/maplibre-gl-leaflet';

interface SafeLayer {
  _glMap?: unknown;
  _container?: HTMLElement;
}
type Method = (this: SafeLayer, ...args: unknown[]) => unknown;

const proto = MaplibreGL.prototype as unknown as Record<string, Method>;

// Leaflet registers a layer's events before it calls `onAdd`. If `onAdd` throws (no WebGL2), the
// plugin keeps listeners that read an undefined `_glMap`, and its `onRemove` throws too (#762).
// Each guard does nothing when the GL map does not exist.
function guard(name: string, whenMissing?: Method): Method {
  const original = proto[name];
  return function (this: SafeLayer, ...args: unknown[]) {
    if (!this._glMap) return whenMissing?.call(this);
    return original.apply(this, args);
  };
}

const extend = (MaplibreGL as unknown as { extend: (o: object) => unknown }).extend;

export const SafeMaplibreGL = extend.call(MaplibreGL, {
  onRemove: guard('onRemove', function (this: SafeLayer) {
    this._container?.remove();
  }),
  _pinchZoom: guard('_pinchZoom'),
  _animateZoom: guard('_animateZoom'),
  _zoomEnd: guard('_zoomEnd'),
  _transitionEnd: guard('_transitionEnd'),
  _update: guard('_update'),
}) as new (options: L.LeafletMaplibreGLOptions) => L.MaplibreGL;
