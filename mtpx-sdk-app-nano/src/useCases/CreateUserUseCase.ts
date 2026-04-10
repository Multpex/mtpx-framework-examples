import type { IUserRepository } from "../repositories/IUserRepository.js";
import type { Users } from "../db/schema.js";

export class CreateUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(data: Partial<Users>) {
    if (!data.name) {
      throw new Error("O nome do usuário é obrigatório.");
    }
    return await this.userRepository.create(data);
  }
}
