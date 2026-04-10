import type { Users } from "../db/schema.js";

export type UserFilters = { active?: string; email?: string; id?: string };

export interface IUserRepository {
  create(data: Partial<Users>): Promise<Users>;
  find(filters: UserFilters): Promise<Users[]>;
  update(id: string, data: Partial<Users>): Promise<number>;
  delete(id: string): Promise<number>;
}
