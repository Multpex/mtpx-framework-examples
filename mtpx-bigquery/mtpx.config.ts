import { env } from "@linkd/sdk-typescript";

export default {
  name: "mtpx-bigquery",
  linkd: {
    socket: env.coalesce("MULTPEX_LINKD_SOCKET", "LINKD_SOCKET") || "/tmp/linkd.sock",
  },
  dev: {
    entry: "src/index.ts",
    watch: ["src"],
  },
};
