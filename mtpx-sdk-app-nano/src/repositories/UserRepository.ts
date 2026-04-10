import type { TypedDatabase } from "@linkd/sdk-typescript";
import type { Schema, Users } from "../db/schema.js";
import type { IUserRepository, UserFilters } from "./IUserRepository.js";
import { randomUUID } from "node:crypto";

export class UserRepository implements IUserRepository {
  constructor(private db: TypedDatabase<Schema>) {}

  async create(data: Partial<Users>): Promise<Users> {
    return await this.db.users.insert({
      id: randomUUID(),
      ...data,
    });
  }

  async find(filters: UserFilters): Promise<Users[]> {
    return await this.db.users
      .when(filters.active !== undefined, (q) =>
        q.whereEquals("active", filters.active === "true")
      )
      .when(filters.email, (q) =>
        q.whereContains("email", filters.email as string)
      )
      .when(filters.id, (q) => q.whereEquals("id", filters.id as string))
      .orderByField("name", "asc")
      .limit(10)
      .get();
  }

  async update(id: string, data: Partial<Users>): Promise<number> {
    return await this.db.users.whereEquals("id", id).update(data);
  }

  async delete(id: string): Promise<number> {
    return await this.db.users.whereEquals("id", id).delete();
  }
}
