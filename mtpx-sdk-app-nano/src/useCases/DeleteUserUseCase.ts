import type { IUserRepository } from "../repositories/IUserRepository.js";

export class DeleteUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(id: string) {
    return await this.userRepository.delete(id);
  }
}
