import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { env } from "./env.ts";
import type { Role } from "./jwt.ts";

const roomService = new RoomServiceClient(env.livekit.internalUrl, env.livekit.apiKey, env.livekit.apiSecret);

export const createMediaToken = async (roomId: string, userId: string, name: string, role: Role) => {
  const token = new AccessToken(env.livekit.apiKey, env.livekit.apiSecret, {
    identity: userId,
    name,
    ttl: "6h",
    metadata: JSON.stringify({ role }),
  });
  token.addGrant({
    room: roomId,
    roomJoin: true,
    roomAdmin: role === "admin",
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
  });
  return token.toJwt();
};

// Media-server side effects are best effort: the DB is the source of truth.
export const removeFromMediaRoom = async (roomId: string, userId: string) => {
  try {
    await roomService.removeParticipant(roomId, userId);
  } catch {
    /* participant was not connected */
  }
};

export const closeMediaRoom = async (roomId: string) => {
  try {
    await roomService.deleteRoom(roomId);
  } catch {
    /* room was not active */
  }
};
