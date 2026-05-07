import { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';

// Custom zoom and fullscreen controls styled for top right
export function CustomMapControls() {
  const map = useMap();
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const container = map.getContainer();
    if (fullscreen) {
      container.classList.add('fullscreen-map');
    } else {
      container.classList.remove('fullscreen-map');
    }
    return () => container.classList.remove('fullscreen-map');
  }, [fullscreen, map]);
  return (
    <div
      style={{
        position: 'absolute',
        top: 24,
        right: 24,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        alignItems: 'start',
      }}
    >
      {/* Fullscreen button */}
      <button
        aria-label="Toggle fullscreen"
        onClick={() => setFullscreen((f) => !f)}
        style={{
          background: '#fff',
          border: 'none',
          borderRadius: '50%',
          boxShadow: '0 4px 16px 0 rgba(34,34,34,0.10)',
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          margin: '0 auto 8px auto',
          transition: 'box-shadow 0.15s, background 0.15s',
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          stroke="#222"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 3H3v4" />
          <path d="M15 3h4v4" />
          <path d="M3 15v4h4" />
          <path d="M19 15v4h-4" />
        </svg>
      </button>
      {/* Zoom controls */}
      <div
        style={{
          background: '#fff',
          borderRadius: 18,
          boxShadow: '0 4px 16px 0 rgba(34,34,34,0.10)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          overflow: 'hidden',
          width: 48,
        }}
      >
        <button
          aria-label="Zoom in"
          onClick={() => map.zoomIn()}
          style={{
            width: 48,
            height: 38,
            border: 'none',
            background: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: 24,
            color: '#222',
            borderBottom: '1px solid #e5e7eb',
            borderRadius: 0,
            transition: 'background 0.15s',
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            stroke="#222"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="11" y1="5" x2="11" y2="17" />
            <line x1="5" y1="11" x2="17" y2="11" />
          </svg>
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => map.zoomOut()}
          style={{
            width: 48,
            height: 38,
            border: 'none',
            background: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: 24,
            color: '#222',
            borderRadius: 0,
            transition: 'background 0.15s',
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            stroke="#222"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="5" y1="11" x2="17" y2="11" />
          </svg>
        </button>
      </div>
      <style>{`
        .fullscreen-map {
          position: fixed !important;
          inset: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          z-index: 9999 !important;
          border-radius: 0 !important;
        }
      `}</style>
    </div>
  );
}
