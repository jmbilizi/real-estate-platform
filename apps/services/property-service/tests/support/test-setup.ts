import axios from 'axios';

/** Points axios at the running service so specs can use relative paths. */
module.exports = async function () {
  const host = process.env.HOST ?? 'localhost';
  // Keep in step with the default in src/main.ts (port 3002 per PRD §2.1).
  const port = process.env.PORT ?? '3002';
  axios.defaults.baseURL = `http://${host}:${port}`;
};
