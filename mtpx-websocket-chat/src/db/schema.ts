/**
 * Database Schema Types for WebSocket Chat Example
 */

export interface Schema extends Record<string, Record<string, unknown>> {
  /** Users table */
  users: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
    status: "online" | "offline" | "away";
    created_at: Date;
    updated_at: Date;
  };

  /** Chat rooms */
  rooms: {
    id: string;
    name: string;
    description: string | null;
    type: "public" | "private" | "direct";
    created_by: string;
    created_at: Date;
    updated_at: Date;
  };

  /** Room membership */
  room_members: {
    id: string;
    room_id: string;
    user_id: string;
    role: "owner" | "admin" | "member";
    joined_at: Date;
  };

  /** Chat messages */
  chat_messages: {
    id: string;
    room_id: string;
    user_id: string;
    content: string;
    message_type: "text" | "image" | "file" | "system";
    metadata: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
  };

  /** Message read receipts */
  read_receipts: {
    id: string;
    message_id: string;
    user_id: string;
    read_at: Date;
  };
}
