import http from "http";
import { createApp } from "./app.js";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { initSocket } from "./realtime/socket.js";

async function main() {
  await connectDb();
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server, env.corsOrigin);
  server.listen(env.port, () => {
    console.log(`API listening on port ${env.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
