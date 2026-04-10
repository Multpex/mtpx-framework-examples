import { createService } from "@linkd/sdk-typescript";
import type { Schema, Users } from "./db/schema.js";
import { UserRepository } from "./repositories/UserRepository.js";
import { CreateUserUseCase } from "./useCases/CreateUserUseCase.js";
import { FindUsersUseCase } from "./useCases/FindUsersUseCase.js";
import { UpdateUserUseCase } from "./useCases/UpdateUserUseCase.js";
import { DeleteUserUseCase } from "./useCases/DeleteUserUseCase.js";

const service = createService<Schema>({
  name: "users",
  database: { defaultDatabase: "mtpx_sdk_app_nano" },
});

service.post("/user", async (ctx) => {
  const repository = new UserRepository(ctx.db);
  const useCase = new CreateUserUseCase(repository);
  return await useCase.execute(ctx.body as Partial<Users>);
});

service.get("/users", async (ctx) => {
  const repository = new UserRepository(ctx.db);
  const useCase = new FindUsersUseCase(repository);
  
  return await useCase.execute({
    active: ctx.query.active as string | undefined,
    email: ctx.query.email as string | undefined,
    id: ctx.query.id as string | undefined,
  });
});

service.put("/user/:id", async (ctx) => {
  const repository = new UserRepository(ctx.db);
  const useCase = new UpdateUserUseCase(repository);
  return await useCase.execute(ctx.params.id as string, ctx.body as Partial<Users>);
});

service.delete("/user/:id", async (ctx) => {
  const repository = new UserRepository(ctx.db);
  const useCase = new DeleteUserUseCase(repository);
  return await useCase.execute(ctx.params.id as string);
});

service.afterStart(() => {
  console.log("Service started successfully!");
});

service.start();
