import { Pool } from 'pg';
import { createApp } from './app';
import { startInquiryDelivery } from './inquiries/delivery/start';

const app = createApp();

// Port 3002 per the service map in PRD §2.1 (property-service:3002).
//
// Parsed explicitly rather than handed to app.listen() as a string. Node does
// bind a numeric string as a TCP port (it only treats a *non-numeric* string as
// a pipe path), so the plain env value would work — but a typo'd PORT would
// then be taken as a pipe name and fail with a confusing ENOENT/EACCES instead
// of naming the real problem. Validating here turns that into a clear error at
// startup, which matters in K8s where the value comes from config.
const port = Number(process.env.PORT ?? 3002);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`Invalid PORT "${process.env.PORT}" — expected an integer between 0 and 65535.`);
}

const server = app.listen(port, () => {
  console.info(`property-service listening at http://localhost:${port}`);
});
// Must exit, not just log. Attaching any 'error' listener suppresses Node's default behaviour of
// throwing on a failed listen, so `console.error` alone would leave the process alive with no
// listening socket — a local dev run that hangs instead of failing, and a container that stays up
// while every request is refused. Exiting non-zero lets Kubernetes restart it and surfaces the real
// cause (EADDRINUSE, EACCES) instead of a silent no-op.
server.on('error', (error) => {
  console.error(`property-service failed to listen on port ${port}:`, error);
  process.exit(1);
});

// Inquiry delivery (#134) runs in this process, off the request path. It sends nothing unless the
// environment declares permission in configuration. See src/inquiries/delivery/config.ts.
// It uses its own small pool: the API pool's 4 s statement_timeout is tuned for request traffic.
if (process.env.DATABASE_URL) {
  const deliveryPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    statement_timeout: 30_000,
  });
  deliveryPool.on('error', (error) => console.error('Inquiry delivery pool error:', error.message));
  const deliveryWorker = startInquiryDelivery(deliveryPool);
  // A SIGTERM listener replaces Node's default exit. Exit here, as the default did.
  process.once('SIGTERM', () => {
    deliveryWorker.stop();
    process.exit(0);
  });
} else {
  console.warn('DATABASE_URL is not set. Inquiry delivery is not started.');
}
