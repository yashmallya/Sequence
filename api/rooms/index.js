import { buildRoomPayload, createRoom } from "../_lib/rooms.js";
import { allowMethods, readJson, sendJson } from "../_lib/http.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    allowMethods(response, ["POST"]);
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
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
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}
