import { describe, expect, it, mock } from "bun:test";
import { DeleteUserUseCase } from "./DeleteUserUseCase.js";
import type { IUserRepository } from "../repositories/IUserRepository.js";

describe("DeleteUserUseCase", () => {
  it("deve repassar o id de exclusão para o repository", async () => {
    const mockDelete = mock().mockResolvedValue(1); // 1 linha afetada

    const fakeRepo: IUserRepository = {
      create: mock(),
      find: mock(),
      update: mock(),
      delete: mockDelete,
    };

    const useCase = new DeleteUserUseCase(fakeRepo);
    const result = await useCase.execute("user-123");

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith("user-123");
    expect(result).toBe(1);
  });
});
