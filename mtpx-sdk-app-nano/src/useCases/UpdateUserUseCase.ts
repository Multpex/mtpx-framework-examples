import type { IUserRepository } from "../repositories/IUserRepository.js";
import type { Users } from "../db/schema.js";

export class UpdateUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(id: string, data: Partial<Users>) {
    return await this.userRepository.update(id, data);
  }
}
