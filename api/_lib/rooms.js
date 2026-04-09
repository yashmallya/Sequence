import { randomBytes } from "node:crypto";

import {
  createGame,
  createPlayerView,
  playTurn,
  turnInDeadCard,
} from "../../game-engine.js";
import { readRoom, withRoomLock, writeRoom } from "./store.js";

function makeId(size = 4) {
  return randomBytes(size).toString("hex");
}

export function getSeat(room, playerId) {
  return room.seats.find((seat) => seat.player_id === playerId) ?? null;
}

export function getViewerPlayerId(room, playerId, token) {
  if (!playerId || !token) {
    return null;
  }

  const seat = getSeat(room, playerId);
  return seat && seat.token === token ? seat.player_id : null;
}

export function isRoomReady(room) {
  return room.seats.every((seat) => seat.claimed);
}

export function buildRoomPayload(room, viewerPlayerId = null) {
  return {
    roomId: room.id,
    status: room.status,
    hostPlayerId: room.hostPlayerId,
    seats: room.seats.map((seat) => ({
      player_id: seat.player_id,
      display_name: seat.display_name,
      claimed: seat.claimed,
      isHost: seat.player_id === room.hostPlayerId,
    })),
    readyToStart: isRoomReady(room),
    game: room.gameState ? createPlayerView(room.gameState, viewerPlayerId) : null,
  };
}

export async function createRoom({ playerCount, names }) {
  const room = {
    id: makeId(3),
    status: "waiting",
    hostPlayerId: "player1",
    seats: Array.from({ length: playerCount }, (_, index) => ({
      player_id: `player${index + 1}`,
      display_name: names[index]?.trim() || (index === 0 ? "Host" : `Open Seat ${index + 1}`),
      claimed: index === 0,
      token: index === 0 ? makeId(12) : null,
    })),
    gameState: null,
  };

  await writeRoom(room);

  return {
    room,
    session: {
      roomId: room.id,
      playerId: "player1",
      token: room.seats[0].token,
    },
  };
}

export async function fetchRoom(roomId) {
  return readRoom(roomId);
}

export async function joinRoom(roomId, playerId, displayName) {
  return withRoomLock(roomId, async (room) => {
    if (!room) {
      throw new Error("Room not found.");
    }
    if (room.status !== "waiting") {
      throw new Error("This room has already started.");
    }

    const seat = getSeat(room, playerId);
    if (!seat) {
      throw new Error("Seat not found.");
    }
    if (seat.claimed) {
      throw new Error("That seat is already taken.");
    }

    seat.claimed = true;
    seat.display_name = displayName?.trim() || seat.display_name;
    seat.token = makeId(12);
    return room;
  });
}

export async function startRoom(roomId, playerId, token) {
  return withRoomLock(roomId, async (room) => {
    if (!room) {
      throw new Error("Room not found.");
    }

    const viewerPlayerId = getViewerPlayerId(room, playerId, token);
    if (!viewerPlayerId) {
      throw new Error("Invalid session.");
    }
    if (viewerPlayerId !== room.hostPlayerId) {
      throw new Error("Only the host can start the room.");
    }
    if (!isRoomReady(room)) {
      throw new Error("All seats must be claimed before starting.");
    }

    room.gameState = createGame({
      players: room.seats.map((seat) => ({
        player_id: seat.player_id,
        display_name: seat.display_name,
      })),
    });
    room.status = "active";
    return room;
  });
}

export async function applyRoomAction(roomId, playerId, token, action, payload) {
  return withRoomLock(roomId, async (room) => {
    if (!room) {
      throw new Error("Room not found.");
    }
    if (!room.gameState) {
      throw new Error("Game has not started yet.");
    }

    const viewerPlayerId = getViewerPlayerId(room, playerId, token);
    if (!viewerPlayerId) {
      throw new Error("Invalid session.");
    }

    if (action === "play-turn") {
      playTurn(room.gameState, viewerPlayerId, payload.handIndex, payload.row, payload.col);
    } else if (action === "turn-in-dead") {
      turnInDeadCard(room.gameState, viewerPlayerId, payload.handIndex);
    } else {
      throw new Error("Unknown action.");
    }

    if (room.gameState.winner) {
      room.status = "finished";
    }

    return room;
  });
}
