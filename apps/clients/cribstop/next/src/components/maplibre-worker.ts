import { setWorkerUrl } from 'maplibre-gl';

// maplibre-gl finds its worker from `import.meta.url`, which the bundler rewrites, so the default
// URL is empty and the worker fails to load. Point it at the worker file as a bundled asset. The
// worker file has no imports, so one emitted file is enough.
setWorkerUrl(String(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url)));
