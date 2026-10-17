import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // (relative: the site also works under a path, as on GitHub Pages)
  server: {
    host: '0.0.0.0',
    port: 5280,
    proxy: {
      '/api/ibb-traffic-index': {
        target: 'https://tkmservices.ibb.gov.tr',
        changeOrigin: true,
        rewrite: () => '/web/api/TrafficData/v1/TrafficIndex_Sc1_Cont',
      },
      '/api/ibb-segment-data': {
        target: 'https://tkmservices.ibb.gov.tr',
        changeOrigin: true,
        rewrite: () => '/web/api/TrafficData/v4/SegmentData',
      },
      '/api/ibb-segments': {
        target: 'https://tkmservices.ibb.gov.tr',
        changeOrigin: true,
        rewrite: () => '/web/api/TrafficData/v3/Segments/0',
      },
    },
  },
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
