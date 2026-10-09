import { renderHook, waitFor } from '@testing-library/react';
import { OPENFREEMAP_CONFIG } from '@/lib/map-providers';
import { useMapConfig } from './map-tiles';

describe('useMapConfig', () => {
  it('falls back to OpenFreeMap when the config fetch fails, never to the OSM tile host', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useMapConfig());

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(OPENFREEMAP_CONFIG));
    expect(JSON.stringify(result.current)).not.toContain('tile.openstreetmap.org');
  });
});
