import { createApp } from "./core/app.js";
import { featureRouter } from "./sync/index.js";

const app = createApp([featureRouter]);

const port = Number(process.env.PORT ?? 3000);

export default {
  port,
  fetch: app.fetch,
};
