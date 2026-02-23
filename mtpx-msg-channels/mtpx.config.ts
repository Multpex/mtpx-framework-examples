import { env } from "@multpex/sdk-typescript";

export default {
  name: "mtpx-msg-channels",
  linkd: {
    socket: env.coalesce("MULTPEX_LINKD_SOCKET", "LINKD_SOCKET") || "/tmp/linkd.sock",
  },
  dev: {
    entry: "src/api.ts",
    watch: ["src"],
  },
};
