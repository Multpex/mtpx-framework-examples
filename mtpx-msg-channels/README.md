# mtpx-msg-channels

Exemplo focado em demonstrar, na prática, a diferença entre:

- `emit` (broadcast): todos os subscribers recebem
- `sendToChannel` (channel): apenas um subscriber por grupo recebe

## Serviços

- `svc-a`: publicador HTTP (`emit` e `channel`)
- `svc-b`: subscriber de evento + consumer de channel
- `svc-c`: subscriber de evento + consumer de channel

`svc-b` e `svc-c` escutam o **mesmo evento** e o **mesmo channel** no grupo `demo-workers`.

## Estrutura

```text
src/
├── api.ts        # bootstrap (startServices)
├── svc_a.ts      # publicador (emit/channel)
├── svc_b.ts      # consumidor + stats
└── svc_c.ts      # consumidor + stats
postman/
├── mtpx-msg-channels.postman_collection.json
└── local.postman_environment.json
```

## Infraestrutura Docker

A infraestrutura compartilhada (PostgreSQL, NATS, Redis, Keycloak) está no projeto:

https://github.com/Multpex/mtpx-framework-dev-infra

Suba os serviços necessários antes de executar os serviços deste exemplo:

```bash
git clone https://github.com/Multpex/mtpx-framework-dev-infra.git
cd /path/to/mtpx-framework-dev-infra
docker compose up -d nats redis
```

## Executando

```bash
cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-msg-channels
bun install
```

### Terminal 1 - Publicador

```bash
bun run dev:svc_a
```

### Terminal 2 - Subscriber/Consumer B

```bash
bun run dev:svc_b
```

### Terminal 3 - Subscriber/Consumer C

```bash
bun run dev:svc_c
```

### Alternativa (um comando)

```bash
bun run dev
```

Esse comando usa `src/api.ts` com `startServices` para subir `svc-a`, `svc-b` e `svc-c` juntos.

### Filtro de serviços (igual ao mtpx-micro-services)

```bash
SERVICE=svc_a bun run dev
SERVICE=svc_b bun run dev
SERVICE=svc_c bun run dev
```

> O filtro usa o nome do arquivo (`svc_a`, `svc_b`, `svc_c`).

## Endpoints principais

- `POST /svc-a/demo/emit` (auth)
- `POST /svc-a/demo/channel` (auth)
- `GET /svc-b/demo/stats`
- `GET /svc-c/demo/stats`

## O que observar no console

### `emit`

Ao chamar `POST /svc-a/demo/emit`:

- `svc-a` loga `[EMIT][svc-a]` publicando
- `svc-b` loga `[EMIT][svc-b]` recebendo
- `svc-c` loga `[EMIT][svc-c]` recebendo

Ou seja, **todos recebem**.

### `channel`

Ao chamar `POST /svc-a/demo/channel`:

- `svc-a` loga `[CHANNEL][svc-a]` publicando
- **apenas um** entre `svc-b` ou `svc-c` loga `[CHANNEL]` para cada mensagem

Ou seja, existe **distribuição de carga por grupo** (`demo-workers`).

## Postman

Importe:

- `postman/mtpx-msg-channels.postman_collection.json`
- `postman/local.postman_environment.json`

Fluxo recomendado:

1. `Auth -> Get Access Token`
2. `Demo -> Emit (Broadcast)`
3. `Stats -> svc-b`
4. `Stats -> svc-c`
5. `Demo -> Channel (Load Balanced)`
6. `Stats -> svc-b`
7. `Stats -> svc-c`
