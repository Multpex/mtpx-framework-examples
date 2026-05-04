# mtpx-channel-monitor

Monitora mensagens de um channel/consumer group configurável via variáveis de ambiente.

## Setup

```bash
bun install
cp .env.example .env
```

## Uso

```bash
MONITOR_CHANNEL=external.payments.received MONITOR_GROUP=my-monitor bun run dev
```

| Variável | Default | Descrição |
|----------|---------|-----------|
| `MONITOR_CHANNEL` | `demo.order.created` | Channel (subject) a monitorar |
| `MONITOR_GROUP` | `channel-monitor` | Consumer group no JetStream |
| `LINKD_CONNECT` | `tcp://localhost:9999` | Endpoint TCP do linkd |
| `LINKD_NAMESPACE` | `mtpx-channel-monitor` | Namespace do serviço |

## Publicar mensagem de teste

O subject NATS real é `{linkd_namespace}.channels.{channel}`. Com o linkd local usando namespace `default`:

```bash
nats pub "default.channels.external.payments.received" \
  '{"orderId":"ORD-001","amount":99.90,"customer":"João"}' \
  --server nats://localhost:4222
```

A mensagem deve aparecer na console do monitor imediatamente.

## Múltiplas instâncias

Se rodar 2+ instâncias com o **mesmo** `MONITOR_GROUP`, as mensagens são distribuídas (load-balanced) entre elas. Com groups **diferentes**, cada instância recebe todas as mensagens independentemente.
