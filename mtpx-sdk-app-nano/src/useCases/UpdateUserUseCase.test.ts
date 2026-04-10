import { describe, expect, it, mock } from "bun:test";
import { UpdateUserUseCase } from "./UpdateUserUseCase.js";
import type { IUserRepository } from "../repositories/IUserRepository.js";

describe("UpdateUserUseCase", () => {
  it("deve repassar o id e os dados de atualização para o repository", async () => {
    const mockUpdate = mock().mockResolvedValue(1); // 1 linha afetada

    const fakeRepo: IUserRepository = {
      create: mock(),
      find: mock(),
      update: mockUpdate,
      delete: mock(),
    };

    const useCase = new UpdateUserUseCase(fakeRepo);
    const result = await useCase.execute("user-123", { name: "Nome Atualizado" });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("user-123", { name: "Nome Atualizado" });
    expect(result).toBe(1);
  });
});
