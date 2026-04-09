import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRoomPayload,
  createRoom,
  fetchRoom,
  getViewerPlayerId,
  joinRoom,
  startRoom,
  applyRoomAction,
} from "./api/_lib/rooms.js";
import { readJson, sendJson } from "./api/_lib/http.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(response, pathname) {
  const target = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(__dirname, target);

  try {
    const contents = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader("Content-Type", MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream");
    response.end(contents);
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
}

function getQueryParams(url) {
  return {
    roomId: url.pathname.split("/")[3] ?? null,
    playerId: url.searchParams.get("playerId"),
    token: url.searchParams.get("token"),
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson(request);
      const playerCount = Number(body.playerCount ?? 2);
      const names = Array.isArray(body.names) ? body.names : [];

      if (playerCount < 2 || playerCount > 4) {
        sendJson(response, 400, { error: "Player count must be between 2 and 4." });
        return;
      }

      const payload = await createRoom({ playerCount, names });
      sendJson(response, 201, {
        session: payload.session,
        room: buildRoomPayload(payload.room, payload.session.playerId),
      });
      return;
    }

    if (request.method === "GET" && /^\/api\/rooms\/[^/]+$/.test(url.pathname)) {
      const { roomId, playerId, token } = getQueryParams(url);
      const room = await fetchRoom(roomId);

      if (!room) {
        sendJson(response, 404, { error: "Room not found." });
        return;
      }

      const viewerPlayerId = getViewerPlayerId(room, playerId, token);
      sendJson(response, 200, buildRoomPayload(room, viewerPlayerId));
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/join$/.test(url.pathname)) {
      const { roomId } = getQueryParams(url);
      const body = await readJson(request);
      const room = await joinRoom(roomId, body.playerId, body.displayName);
      const seat = room.seats.find((entry) => entry.player_id === body.playerId);

      sendJson(response, 200, {
        session: {
          roomId,
          playerId: seat.player_id,
          token: seat.token,
        },
        room: buildRoomPayload(room, seat.player_id),
      });
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/start$/.test(url.pathname)) {
      const { roomId } = getQueryParams(url);
      const body = await readJson(request);
      const room = await startRoom(roomId, body.playerId, body.token);
      const viewerPlayerId = getViewerPlayerId(room, body.playerId, body.token);
      sendJson(response, 200, buildRoomPayload(room, viewerPlayerId));
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/action$/.test(url.pathname)) {
      const { roomId } = getQueryParams(url);
      const body = await readJson(request);
      const room = await applyRoomAction(roomId, body.playerId, body.token, body.action, body);
      const viewerPlayerId = getViewerPlayerId(room, body.playerId, body.token);
      sendJson(response, 200, buildRoomPayload(room, viewerPlayerId));
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status =
      message === "Room not found." || message === "Seat not found."
        ? 404
        : message === "Invalid session."
          ? 401
          : message === "Only the host can start the room." || message === "This room has already started."
            ? 409
            : 400;
    sendJson(response, status, { error: message });
    return;
  }

  await serveStatic(response, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Sequence server running on http://${HOST}:${PORT}`);
});
