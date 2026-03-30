import type { MigrationFile } from "@linkd/sdk-typescript";

export const migrations: MigrationFile[] = [
  {
    name: "001_init",
    version: "2026-03-29-0001",
    up_statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(100) NOT NULL,
        email       VARCHAR(255) NOT NULL UNIQUE,
        role        VARCHAR(50)  NOT NULL DEFAULT 'user',
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS notes (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title       VARCHAR(200) NOT NULL,
        body        TEXT         NOT NULL DEFAULT '',
        author      VARCHAR(100) NOT NULL DEFAULT 'system',
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
    down_statements: [
      `DROP TABLE IF EXISTS notes`,
      `DROP TABLE IF EXISTS users`,
    ],
  },
  {
    name: "002_add_created_at_indexes",
    version: "2026-03-30-0002",
    up_statements: [
      `CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes (created_at DESC)`,
    ],
    down_statements: [
      `DROP INDEX IF EXISTS idx_notes_created_at`,
      `DROP INDEX IF EXISTS idx_users_created_at`,
    ],
  },
];
