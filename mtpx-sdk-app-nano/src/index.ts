import { createService } from "@linkd/sdk-typescript";
import type { Schema } from "./db/schema.js";

const service = createService<Schema>({
  name: "users",
  connect: "tcp://localhost:9999",
  database: { defaultDatabase: "mtpx_sdk_app" },
});

service.get("/users", async (ctx) => {
  return await ctx.db.users
    .whereEquals("active", true)
    .orderByField("name", "asc")
    .limit(10)
    .get();
});

service.afterStart(() => {
  console.log("Service started successfully!");
});

service.start();