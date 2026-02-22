import { env } from "@multpex/typescript-sdk";

export default {
  name: "mtpx-websocket-chat",
  linkd: {
    socket: env.coalesce("MULTPEX_LINKD_SOCKET", "LINKD_SOCKET") || "/tmp/linkd.sock",
  },
  dev: {
    entry: "src/main.ts",
    watch: ["src"],
  },
};
