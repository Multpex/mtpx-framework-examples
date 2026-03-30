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
];
