import { buildRoomPayload, getViewerPlayerId, startRoom } from "../../_lib/rooms.js";
import { allowMethods, readJson, sendJson } from "../../_lib/http.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    allowMethods(response, ["POST"]);
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const { roomId } = request.query;
    const body = await readJson(request);
    const room = await startRoom(roomId, body.playerId, body.token);
    const viewerPlayerId = getViewerPlayerId(room, body.playerId, body.token);
    sendJson(response, 200, buildRoomPayload(room, viewerPlayerId));
  } catch (error) {
    const status = error.message === "Room not found." ? 404 : error.message === "Invalid session." ? 401 : 409;
    sendJson(response, status, { error: error.message });
  }
}
