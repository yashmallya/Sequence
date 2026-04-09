import { buildRoomPayload, joinRoom } from "../../_lib/rooms.js";
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
  } catch (error) {
    const status = error.message === "Room not found." || error.message === "Seat not found." ? 404 : 409;
    sendJson(response, status, { error: error.message });
  }
}
