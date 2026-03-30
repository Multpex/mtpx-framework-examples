# mtpx-runtime-db

Exemplo que demonstra os **três modos oficiais de acesso a banco** definidos pelo RFC 0005, usando um único app monolítico criado com `createApp<Schema>()`.

## O que é demonstrado

| Modo | API | Quando |
|---|---|---|
| **Request DB** | `ctx.db` em HTTP handlers | Durante request HTTP — com escopo de user/tenant |
| **Runtime DB** | `app.runtime.db` / `ctx.db` em lifecycle hooks | Fora de request — system scope |
| **Detached DB** | `createRuntimeContext()` | Antes do service subir — bootstrap, migrations |

## Fluxo de inicialização

```
1. runMigrations()          — Detached Runtime DB (createRuntimeContext)
       ↓
2. app.start()
       ↓
3. afterConnect(ctx)        — Runtime DB disponível, service não registrado ainda
       ↓                       Usado para seed de app_config
4. afterStart()             — Service registrado, rotas ativas
       ↓                       Lê configs via app.runtime.db
5. HTTP handlers ativos     — Request DB (ctx.db com escopo de request)
```

## Setup

```bash
# 1. Copie e ajuste o .env
cp .env.example .env

# 2. Instale as deps
bun install

# 3. Garanta que o database está provisionado no linkd
mtpx db database create docker-pg-test --server docker-pg

# 4. Rode
bun dev
```

## Endpoints

```
GET  /notes          — lista notas (Request DB)
POST /notes          — cria nota + despacha job de audit (Request DB + Job)
GET  /notes/:id      — busca nota por id
DELETE /notes/:id    — remove nota
GET  /config         — lê app_config (preload feito em afterConnect)
GET  /audit          — lê audit_log (escrito por jobs e beforeStop)
```

## Pré-requisitos

- linkd rodando (`tcp://localhost:9999` ou configurar `LINKD_CONNECT`)
- database provisionado via `mtpx db database create`
- `LINKD_DATABASE_NAME` no `.env`
