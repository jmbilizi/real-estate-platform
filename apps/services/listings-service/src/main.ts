import { createApp } from './app';

const app = createApp();

const port = process.env.PORT || 3333;
const server = app.listen(port, () => {
  console.info(`listings-service listening at http://localhost:${port}`);
});
server.on('error', console.error);
