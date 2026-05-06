import {
  createService,
  env,
  type ChannelContext,
} from "@linkd/sdk-typescript";

const CHANNEL = env.string("MONITOR_CHANNEL", "voucher.legado");
const GROUP = env.string("MONITOR_GROUP", "channel-monitor");

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  Channel Monitor`);
console.log(`  channel: ${CHANNEL}`);
console.log(`  group:   ${GROUP}`);
console.log(`═══════════════════════════════════════════════\n`);

const app = createService({
  name: "channel-monitor",
  version: "1.0.0",
  namespace: env.string("LINKD_NAMESPACE", "mtpx-channel-monitor"),
});

let count = 0;

app.channel(
  CHANNEL,
  {
    group: GROUP,
    maxInFlight: 10,
    retryAttempts: 1,
    description: `Monitor de mensagens no channel ${CHANNEL}`,
  },
  async (ctx: ChannelContext<unknown>) => {
    count += 1;
    const ts = new Date().toISOString();

    console.log(`\n┌─ #${count} [${ts}]`);
    console.log(`│ channel: ${ctx.channel}`);
    console.log(`│ group:   ${ctx.group}`);
    console.log(`│ from:    ${ctx.sourceService}`);
    console.log(`│ msg_id:  ${ctx.message.id}`);
    console.log(`│ payload:`);
    console.log(`│   ${JSON.stringify(ctx.body, null, 2).replace(/\n/g, "\n│   ")}`);
    console.log(`└─────────────────────────────────────────`);

    await ctx.message.ack();
  },
);

app.start();
