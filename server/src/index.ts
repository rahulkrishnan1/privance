import { createApp } from "./core/app.js";

const app = createApp([]);

const port = Number(process.env.PORT ?? 3000);

export default {
  port,
  fetch: app.fetch,
};
