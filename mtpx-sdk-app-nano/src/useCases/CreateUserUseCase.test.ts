import { describe, expect, it, mock } from "bun:test";
import { CreateUserUseCase } from "./CreateUserUseCase.js";
import type { IUserRepository } from "../repositories/IUserRepository.js";
import type { Users } from "../db/schema.js";

describe("CreateUserUseCase", () => {
  it("deve criar um usuário com sucesso", async () => {
    const mockCreate = mock().mockResolvedValue({
      id: "mock-id",
      name: "Danilo",
      email: "danilo@teste.com",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Users);

    const fakeRepo: IUserRepository = {
      create: mockCreate,
      find: mock(),
      update: mock(),
      delete: mock(),
    };

    const useCase = new CreateUserUseCase(fakeRepo);
    const result = await useCase.execute({ name: "Danilo", email: "danilo@teste.com" });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({ name: "Danilo", email: "danilo@teste.com" });
    expect(result.id).toBe("mock-id");
    expect(result.name).toBe("Danilo");
  });

  it("deve lançar um erro se o nome não for enviado", async () => {
    const fakeRepo: IUserRepository = {
      create: mock(),
      find: mock(),
      update: mock(),
      delete: mock(),
    };

    const useCase = new CreateUserUseCase(fakeRepo);

    expect(useCase.execute({ email: "danilo@teste.com" })).rejects.toThrow("O nome do usuário é obrigatório.");
    expect(fakeRepo.create).not.toHaveBeenCalled();
  });
});
