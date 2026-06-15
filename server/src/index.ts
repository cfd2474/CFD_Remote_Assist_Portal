import http from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { SERVICE_NAME, VERSION } from "./version.js";
import { deviceApiRouter } from "./routes/deviceApi.js";
import { adminApiRouter } from "./routes/adminApi.js";
import { attachWebSocketHandlers } from "./ws/handlers.js";
import { resetLiveSessionFlags, purgeOldLocationHistory } from "./services/devices.js";

const app = express();

app.set("etag", false);
app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  next();
});
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api/v1", (req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    console.log(
      `Device API ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms ip=${req.ip}`
    );
  });
  next();
});

const deviceLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: SERVICE_NAME, version: VERSION });
});

app.get("/version", (_req, res) => {
  res.json({ version: VERSION, service: SERVICE_NAME });
});

app.use("/api/v1", deviceLimiter, deviceApiRouter);
app.use("/api/admin", adminApiRouter);

const server = http.createServer(app);

const deviceWss = new WebSocketServer({ noServer: true });
const adminWss = new WebSocketServer({ noServer: true });

attachWebSocketHandlers(deviceWss, "/ws/device");
attachWebSocketHandlers(adminWss, "/ws/admin");

server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";

  if (url.startsWith("/ws/device")) {
    deviceWss.handleUpgrade(req, socket, head, (ws) => {
      deviceWss.emit("connection", ws, req);
    });
    return;
  }

  if (url.startsWith("/ws/admin")) {
    adminWss.handleUpgrade(req, socket, head, (ws) => {
      adminWss.emit("connection", ws, req);
    });
    return;
  }

  socket.destroy();
});

const LOCATION_HISTORY_PURGE_MS = 24 * 60 * 60 * 1000;

async function runLocationHistoryPurge(): Promise<void> {
  try {
    const deleted = await purgeOldLocationHistory();
    if (deleted > 0) {
      console.log(
        `Purged ${deleted} location history record(s) older than 30 days`
      );
    }
  } catch (err) {
    console.error("Location history purge failed:", err);
  }
}

void resetLiveSessionFlags().then(async () => {
  await runLocationHistoryPurge();
  setInterval(runLocationHistoryPurge, LOCATION_HISTORY_PURGE_MS);

  server.listen(config.port, () => {
    console.log(
      `EUD Remote Assist Portal v${VERSION} listening on port ${config.port}`
    );
  });
});
