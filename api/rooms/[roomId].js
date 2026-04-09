import { buildRoomPayload, fetchRoom, getViewerPlayerId } from "../_lib/rooms.js";
import { allowMethods, sendJson } from "../_lib/http.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    allowMethods(response, ["GET"]);
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const { roomId, playerId, token } = request.query;

  const room = await fetchRoom(roomId);
  if (!room) {
    sendJson(response, 404, { error: "Room not found." });
    return;
  }

  const viewerPlayerId = getViewerPlayerId(room, playerId, token);
  sendJson(response, 200, buildRoomPayload(room, viewerPlayerId));
}
