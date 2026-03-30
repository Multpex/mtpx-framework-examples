/**
 * Database Schema
 *
 * Row types para as tabelas deste app.
 * Em produção, gerado automaticamente via `mtpx db:generate`.
 */

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
  [key: string]: unknown;
};

export type NoteRow = {
  id: string;
  title: string;
  body: string;
  author: string;
  created_at: string;
  [key: string]: unknown;
};

export type Schema = {
  users: UserRow;
  notes: NoteRow;
  [key: string]: Record<string, unknown>;
};
