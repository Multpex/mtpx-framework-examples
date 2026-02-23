/**
 * Chat Service with WebSocket Handlers
 *
 * Demonstrates the WebSocket API following the same pattern as HTTP actions:
 * - service.ws.on() for message handlers
 * - service.ws.onConnect() / onDisconnect() for lifecycle
 * - service.ws.group() for grouping handlers
 * - service.ws.use() for middleware
 * - ctx.to(room).emit() for broadcasting
 */

import { z } from "zod";
import {
  createService,
  ForbiddenError,
  UnauthorizedError,
  env,
} from "@multpex/sdk-typescript";
import type {
  WebSocketContext,
  WebSocketMiddleware,
  WebSocketGroupAPI,
  TypedServiceContext,
} from "@multpex/sdk-typescript";
import type { Schema } from "../db/schema.js";

// Type alias for WebSocket context with our schema
type WsCtx = WebSocketContext<Schema>;

// =============================================================================
// Validation Schemas
// =============================================================================

const SendMessageSchema = z.object({
  room: z.string().uuid("Room ID must be a valid UUID"),
  message: z.string().min(1, "Message cannot be empty").max(4000, "Message too long"),
  type: z.enum(["text", "image", "file"]).default("text"),
  metadata: z.record(z.unknown()).optional(),
});

const JoinRoomSchema = z.object({
  room: z.string().uuid("Room ID must be a valid UUID"),
});

const LeaveRoomSchema = z.object({
  room: z.string().uuid("Room ID must be a valid UUID"),
});

const TypingSchema = z.object({
  room: z.string().uuid("Room ID must be a valid UUID"),
  isTyping: z.boolean(),
});

const HistorySchema = z.object({
  room: z.string().uuid("Room ID must be a valid UUID"),
  limit: z.number().int().min(1).max(100).default(50),
  before: z.string().uuid().optional(), // Cursor pagination
});

// =============================================================================
// Service Configuration
// =============================================================================

const IS_PRODUCTION = env.string("NODE_ENV", "development") === "production";

const service = createService<Schema>({
  name: "chat",
  version: "1.0.0",
  namespace: "websocket-chat",

  // WebSocket configuration
  websocket: {
    enabled: true,
    path: "/ws/chat",
    heartbeatIntervalMs: 30000,
    maxConnectionsPerUser: 5,
    maxMessageSizeBytes: 64 * 1024,
    compression: true,
  },

  // Standard health endpoints
  health: {
    enabled: true,
    healthRoute: "/chat/health",
    readyRoute: "/chat/ready",
    liveRoute: "/chat/live",
  },

  // Logging
  logging: {
    level: IS_PRODUCTION ? "info" : "debug",
    basePath: "./logs",
    file: IS_PRODUCTION,
    console: true,
    pretty: !IS_PRODUCTION,
  },

  defaults: {
    datetime: { displayTimezone: "America/Sao_Paulo" },
  },
});

// =============================================================================
// Lifecycle Hooks
// =============================================================================

service.beforeStart(async () => {
  service.logger.info("Starting Chat WebSocket service");
});

service.afterStart(async () => {
  service.logger.info("Chat service ready", {
    websocketPath: "/ws/chat",
    features: ["rooms", "typing-indicators", "message-history"],
  });
});

// =============================================================================
// WebSocket Lifecycle Handlers
// =============================================================================

/**
 * Called when a new WebSocket connection is established.
 * Auto-joins the user to their rooms.
 */
service.ws.onConnect(async (ctx: WsCtx) => {
  ctx.logger.info("Client connected", {
    socketId: ctx.socket.id,
    userId: ctx.auth?.userId,
    remoteAddress: ctx.socket.remoteAddress,
  });

  // If authenticated, load user's rooms and auto-join
  if (ctx.auth?.userId) {
    const memberships = await ctx.db.room_members
      .whereEquals("user_id", ctx.auth.userId)
      .get();

    for (const membership of memberships) {
      await ctx.join(membership.room_id);
      ctx.logger.debug("Auto-joined room", { room: membership.room_id });
    }

    // Notify presence to all rooms
    const rooms = await ctx.rooms();
    for (const room of rooms) {
      await ctx.to(room).except(ctx.socket.id).emit("user.online", {
        userId: ctx.auth.userId,
        username: ctx.auth.username,
      });
    }

    // Update user status in database
    await ctx.db.users
      .whereEquals("id", ctx.auth.userId)
      .update({ status: "online" });
  }
});

/**
 * Called when a WebSocket connection is closed.
 * Notifies other users and updates presence.
 */
service.ws.onDisconnect(async (ctx: WsCtx) => {
  ctx.logger.info("Client disconnected", {
    socketId: ctx.socket.id,
    userId: ctx.auth?.userId,
  });

  if (ctx.auth?.userId) {
    // Notify all rooms the user was in
    const rooms = await ctx.rooms();
    for (const room of rooms) {
      await ctx.to(room).emit("user.offline", {
        userId: ctx.auth.userId,
        username: ctx.auth.username,
      });
    }

    // Update user status
    await ctx.db.users
      .whereEquals("id", ctx.auth.userId)
      .update({ status: "offline" });
  }
});

/**
 * Catch-all for unrecognized message types.
 */
service.ws.onMessage(async (ctx: WsCtx) => {
  ctx.logger.warn("Unknown message type", {
    type: ctx.messageType,
    socketId: ctx.socket.id,
  });

  await ctx.send("error", {
    code: "UNKNOWN_MESSAGE_TYPE",
    message: `Unknown message type: ${ctx.messageType}`,
  });
});

// =============================================================================
// WebSocket Middleware
// =============================================================================

/**
 * Global logging middleware for all WebSocket handlers.
 */
service.ws.use(async (ctx: WsCtx, next: () => Promise<void>) => {
  const start = Date.now();

  try {
    await next();
  } finally {
    const duration = Date.now() - start;
    ctx.logger.debug("WebSocket handler completed", {
      type: ctx.messageType,
      duration,
      socketId: ctx.socket.id,
    });
  }
});

/**
 * Authentication middleware for chat.* handlers.
 * With Linkd JWT validation enabled, ctx.auth is populated from the JWT token.
 */
service.ws.use("chat.*", async (ctx: WsCtx, next: () => Promise<void>) => {
  // With require_auth=true in Linkd config, all connections require valid JWT
  // ctx.auth is automatically populated from the token claims
  ctx.logger.debug("Auth context", {
    userId: ctx.auth?.userId,
    username: ctx.auth?.username,
    roles: ctx.auth?.roles,
  });
  await next();
});

// =============================================================================
// WebSocket Handlers (grouped under "chat")
// =============================================================================

// WebSocket JWT authentication is handled by Linkd - all handlers require auth
service.ws.group("chat", { auth: true }, (ws: WebSocketGroupAPI<Schema>) => {
  /**
   * Send a message to a room.
   *
   * Request: { type: "chat.send", data: { room, message, type?, metadata? } }
   * Response: { success: true, messageId: "uuid" }
   * Broadcast: "chat.message" to all room members
   */
  ws.on("send", async (ctx: WsCtx) => {
    const data = SendMessageSchema.parse(ctx.message);

    // Verify user is in the room
    const rooms = await ctx.rooms();
    if (!rooms.includes(data.room)) {
      throw new ForbiddenError("You must join the room first");
    }

    // Persist the message
    const insertData: Record<string, unknown> = {
      room_id: data.room,
      user_id: ctx.auth!.userId,
      content: data.message,
      message_type: data.type,
    };
    // Only add metadata if provided (JSONB column requires proper null handling)
    if (data.metadata !== undefined) {
      insertData.metadata = data.metadata;
    }
    const message = await ctx.db.chat_messages.insert(insertData);

    // Broadcast to all room members
    await ctx.to(data.room).emit("chat.message", {
      id: message.id,
      roomId: data.room,
      userId: ctx.auth!.userId,
      username: ctx.auth!.username,
      content: data.message,
      messageType: data.type,
      metadata: data.metadata,
      createdAt: message.created_at,
    });

    ctx.logger.info("Message sent", {
      messageId: message.id,
      room: data.room,
      userId: ctx.auth!.userId,
    });

    // Acknowledge to sender
    return { success: true, messageId: message.id };
  });

  /**
   * Join a room.
   *
   * Request: { type: "chat.join", data: { room } }
   * Response: { success: true, room, members: [...] }
   * Broadcast: "user.joined" to room members
   */
  ws.on("join", async (ctx: WsCtx) => {
    const { room } = JoinRoomSchema.parse(ctx.message);

    // Verify membership in database
    const membership = await ctx.db.room_members
      .whereEquals("room_id", room)
      .whereEquals("user_id", ctx.auth!.userId)
      .first();

    if (!membership) {
      throw new ForbiddenError("You are not a member of this room");
    }

    // Join the WebSocket room
    await ctx.join(room);

    // Get other online members
    // Note: This would require tracking in sidecar, simplified here
    const members = await ctx.db.room_members
      .whereEquals("room_id", room)
      .get();

    // Notify others
    await ctx.to(room).except(ctx.socket.id).emit("user.joined", {
      userId: ctx.auth!.userId,
      username: ctx.auth!.username,
      roomId: room,
    });

    ctx.logger.info("User joined room", {
      room,
      userId: ctx.auth!.userId,
    });

    return {
      success: true,
      room,
      memberCount: members.length,
    };
  });

  /**
   * Leave a room.
   *
   * Request: { type: "chat.leave", data: { room } }
   * Response: { success: true }
   * Broadcast: "user.left" to room members
   */
  ws.on("leave", async (ctx: WsCtx) => {
    const { room } = LeaveRoomSchema.parse(ctx.message);

    // Notify others before leaving
    await ctx.to(room).except(ctx.socket.id).emit("user.left", {
      userId: ctx.auth!.userId,
      username: ctx.auth!.username,
      roomId: room,
    });

    // Leave the WebSocket room
    await ctx.leave(room);

    ctx.logger.info("User left room", {
      room,
      userId: ctx.auth!.userId,
    });

    return { success: true };
  });

  /**
   * Send typing indicator.
   *
   * Request: { type: "chat.typing", data: { room, isTyping } }
   * Broadcast: "user.typing" to room members (excluding sender)
   */
  ws.on("typing", async (ctx: WsCtx) => {
    const { room, isTyping } = TypingSchema.parse(ctx.message);

    // Verify user is in room
    const rooms = await ctx.rooms();
    if (!rooms.includes(room)) {
      throw new ForbiddenError("You are not in this room");
    }

    // Broadcast to others (not awaited for performance)
    ctx.to(room).except(ctx.socket.id).emit("user.typing", {
      userId: ctx.auth!.userId,
      username: ctx.auth!.username,
      roomId: room,
      isTyping,
    });

    // No response needed for typing indicators
  });

  /**
   * Get message history.
   *
   * Request: { type: "chat.history", data: { room, limit?, before? } }
   * Response: { messages: [...], hasMore: boolean }
   */
  ws.on("history", async (ctx: WsCtx) => {
    const { room, limit, before } = HistorySchema.parse(ctx.message);

    // Verify user is in room
    const rooms = await ctx.rooms();
    if (!rooms.includes(room)) {
      throw new ForbiddenError("You are not in this room");
    }

    // Build query with cursor pagination
    let query = ctx.db.chat_messages
      .whereEquals("room_id", room)
      .orderByField("created_at", "desc")
      .limit(limit + 1); // Fetch one extra to check if there's more

    if (before) {
      query = query.whereLt("id", before);
    }

    const messages = await query.get();

    // Check if there are more messages
    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop(); // Remove the extra message
    }

    ctx.logger.debug("Fetched message history", {
      room,
      count: messages.length,
      hasMore,
    });

    return {
      messages: messages.reverse(), // Chronological order
      hasMore,
    };
  });

  /**
   * Get list of rooms user has joined (WebSocket rooms).
   *
   * Request: { type: "chat.rooms" }
   * Response: { rooms: ["room-id-1", "room-id-2"] }
   */
  ws.on("rooms", async (ctx: WsCtx) => {
    const rooms = await ctx.rooms();
    return { rooms };
  });
});

// =============================================================================
// HTTP Actions (for non-realtime operations)
// =============================================================================

// Type alias for HTTP action context
type HttpCtx = TypedServiceContext<Schema>;

/**
 * List rooms the user is a member of.
 * GET /chat/rooms
 */
service.action(
  "list-rooms",
  { route: "/chat/rooms", method: "GET", auth: true },
  async (ctx: HttpCtx) => {
    // Get all rooms where user is a member
    const memberships = await ctx.db.room_members
      .whereEquals("user_id", ctx.user!.id)
      .get();

    if (memberships.length === 0) {
      return { rooms: [], total: 0 };
    }

    const roomIds = memberships.map((m) => m.room_id);

    const rooms = await ctx.db.rooms
      .whereIn("id", roomIds)
      .orderByField("updated_at", "desc")
      .get();

    // Build response with membership info
    const roomsWithMembership = rooms.map((room) => {
      const membership = memberships.find((m) => m.room_id === room.id);
      return {
        ...room,
        role: membership?.role,
        joinedAt: membership?.joined_at,
      };
    });

    return {
      rooms: roomsWithMembership,
      total: rooms.length,
    };
  }
);

/**
 * Get room details.
 * GET /chat/rooms/:id
 */
service.action(
  "get-room",
  { route: "/chat/rooms/:id", method: "GET", auth: true },
  async (ctx: HttpCtx) => {
    const { id } = ctx.params;

    const room = await ctx.db.rooms.whereEquals("id", id).first();

    if (!room) {
      throw new Error("Room not found");
    }

    // Verify membership
    const membership = await ctx.db.room_members
      .whereEquals("room_id", id)
      .whereEquals("user_id", ctx.user!.id)
      .first();

    if (!membership && room.type === "private") {
      throw new ForbiddenError("You are not a member of this room");
    }

    const memberCount = await ctx.db.room_members
      .whereEquals("room_id", id)
      .count();

    return {
      ...room,
      memberCount,
      membership: membership?.role,
    };
  }
);

/**
 * Create a new room.
 * POST /chat/rooms
 */
service.action(
  "create-room",
  { route: "/chat/rooms", method: "POST", auth: true },
  async (ctx: HttpCtx) => {
    const schema = z.object({
      name: z.string().min(2).max(100),
      description: z.string().max(500).optional(),
      type: z.enum(["public", "private"]).default("private"),
    });

    const data = schema.parse(ctx.body);

    const room = await ctx.db.rooms.insert({
      name: data.name,
      description: data.description ?? null,
      type: data.type,
      created_by: ctx.user!.id,
    });

    // Add creator as owner
    await ctx.db.room_members.insert({
      room_id: room.id,
      user_id: ctx.user!.id,
      role: "owner",
    });

    ctx.emit("room.created", { roomId: room.id, createdBy: ctx.user!.id });

    return room;
  }
);

export default service;
