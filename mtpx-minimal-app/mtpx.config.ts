import { env } from "@linkd/sdk-typescript";

// `linkd.connect` honra LINKD_CONNECT (tcp://host:port ou unix:///path.sock)
// e cai para socket unix legacy se nenhum LINKD_CONNECT estiver definido.
const linkdConnect = env.coalesce("LINKD_CONNECT");
const linkdSocket = env.coalesce("MULTPEX_LINKD_SOCKET", "LINKD_SOCKET") || "/tmp/linkd.sock";

export default {
  name: "mtpx-minimal-app",
  linkd: {
    connect: linkdConnect,
    socket: linkdSocket,
  },
  dev: {
    entry: "src/index.ts",
    watch: ["src"],
  },
};
