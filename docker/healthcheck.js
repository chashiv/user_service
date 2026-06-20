// Container HEALTHCHECK script. Pings the local /health endpoint over loopback.
// Exits 0 if the service answers 2xx, 1 otherwise. Uses only Node stdlib so we
// don't need curl/wget in the slim runtime image.

const http = require('http');

const port = process.env.PORT || 4000;

const req = http.get(
  { host: '127.0.0.1', port, path: '/health', timeout: 2000 },
  (res) => {
    process.exit(res.statusCode && res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
  },
);

req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
