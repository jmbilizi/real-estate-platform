import { createApp } from './app';

const app = createApp();

// Port 3002 per the service map in PRD §2.1 (listings-service:3002).
const port = process.env.PORT || 3002;
const server = app.listen(port, () => {
  console.info(`listings-service listening at http://localhost:${port}`);
});
server.on('error', console.error);
