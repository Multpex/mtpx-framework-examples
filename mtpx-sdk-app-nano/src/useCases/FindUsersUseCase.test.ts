import { describe, expect, it, mock } from "bun:test";
import { FindUsersUseCase } from "./FindUsersUseCase.js";
import type { IUserRepository } from "../repositories/IUserRepository.js";
import type { Users } from "../db/schema.js";

describe("FindUsersUseCase", () => {
  it("deve repassar os filtros corretamente para o repository", async () => {
    const mockUsers = [
      { id: "1", name: "User 1", active: true },
      { id: "2", name: "User 2", active: true }
    ] as Users[];

    const mockFind = mock().mockResolvedValue(mockUsers);

    const fakeRepo: IUserRepository = {
      create: mock(),
      find: mockFind,
      update: mock(),
      delete: mock(),
    };

    const useCase = new FindUsersUseCase(fakeRepo);
    const filters = { active: "true", email: "test@test.com" };
    
    const result = await useCase.execute(filters);

    expect(mockFind).toHaveBeenCalledTimes(1);
    expect(mockFind).toHaveBeenCalledWith(filters);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("User 1");
  });
});
