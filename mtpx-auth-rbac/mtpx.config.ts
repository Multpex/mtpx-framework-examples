import { env } from "@multpex/typescript-sdk";

export default {
  name: "mtpx-auth-rbac",
  linkd: {
    socket: env.coalesce("MULTPEX_LINKD_SOCKET", "LINKD_SOCKET") || "/tmp/linkd.sock",
  },
  dev: {
    entry: "src/index.ts",
    watch: ["src"],
  },
};
