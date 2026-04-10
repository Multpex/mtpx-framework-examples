import type { IUserRepository, UserFilters } from "../repositories/IUserRepository.js";

export class FindUsersUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(filters: UserFilters) {
    return await this.userRepository.find(filters);
  }
}
