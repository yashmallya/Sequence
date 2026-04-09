import { createClient } from "redis";
import { deserializeState, serializeState } from "../../game-engine.js";

const ROOM_PREFIX = "sequence:room:";
const LOCK_PREFIX = "sequence:lock:";
const LOCK_TTL_MS = 5000;

const memory = globalThis.__sequenceMemoryStore ?? {
  rooms: new Map(),
  locks: new Map(),
};
globalThis.__sequenceMemoryStore = memory;

let redisClientPromise = null;

async function getRedisClient() {
  if (!process.env.REDIS_URL) {
    if (process.env.VERCEL) {
      throw new Error("REDIS_URL is required in Vercel for persistent multiplayer rooms.");
    }
    return null;
  }

  if (!redisClientPromise) {
    const client = createClient({
      url: process.env.REDIS_URL,
    });
    redisClientPromise = client.connect().then(() => client);
  }

  return redisClientPromise;
}

function getRoomKey(roomId) {
  return `${ROOM_PREFIX}${roomId}`;
}

function getLockKey(roomId) {
  return `${LOCK_PREFIX}${roomId}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function serializeRoom(room) {
  return {
    ...room,
    gameState: room.gameState ? serializeState(room.gameState) : null,
  };
}

function deserializeRoom(room) {
  if (!room) {
    return null;
  }

  return {
    ...room,
    gameState: room.gameState ? deserializeState(room.gameState) : null,
  };
}

export async function readRoom(roomId) {
  const redis = await getRedisClient();
  if (!redis) {
    return deserializeRoom(clone(memory.rooms.get(roomId) ?? null));
  }

  const payload = await redis.get(getRoomKey(roomId));
  return payload ? deserializeRoom(JSON.parse(payload)) : null;
}

export async function writeRoom(room) {
  const redis = await getRedisClient();
  const payload = serializeRoom(room);
  if (!redis) {
    memory.rooms.set(room.id, clone(payload));
    return;
  }

  await redis.set(getRoomKey(room.id), JSON.stringify(payload));
}

async function acquireMemoryLock(roomId, token) {
  const current = memory.locks.get(roomId);
  const now = Date.now();
  if (current && current.expiresAt > now) {
    return false;
  }
  memory.locks.set(roomId, {
    token,
    expiresAt: now + LOCK_TTL_MS,
  });
  return true;
}

async function releaseMemoryLock(roomId, token) {
  const current = memory.locks.get(roomId);
  if (current?.token === token) {
    memory.locks.delete(roomId);
  }
}

async function acquireRedisLock(redis, roomId, token) {
  const result = await redis.set(getLockKey(roomId), token, {
    NX: true,
    PX: LOCK_TTL_MS,
  });
  return result === "OK";
}

async function releaseRedisLock(redis, roomId, token) {
  const key = getLockKey(roomId);
  const current = await redis.get(key);
  if (current === token) {
    await redis.del(key);
  }
}

export async function withRoomLock(roomId, action) {
  const redis = await getRedisClient();
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;
  const acquire = redis
    ? () => acquireRedisLock(redis, roomId, token)
    : () => acquireMemoryLock(roomId, token);
  const release = redis
    ? () => releaseRedisLock(redis, roomId, token)
    : () => releaseMemoryLock(roomId, token);

  const start = Date.now();
  while (!(await acquire())) {
    if (Date.now() - start > 3000) {
      throw new Error("Room is busy. Please retry.");
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  try {
    const room = await readRoom(roomId);
    const result = await action(room);
    if (result) {
      await writeRoom(result);
    }
    return result;
  } finally {
    await release();
  }
}
