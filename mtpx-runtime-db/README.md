# mtpx-runtime-db

Exemplo que demonstra os **três modos oficiais de acesso a banco** definidos pelo RFC 0005, usando um único service criado com `createService<Schema>()`.

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
       ↓                       Configura cache HTTP e lê dados via service.runtime.db
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

## Performance

O exemplo já sobe com:

- cache HTTP habilitado para `GET /users`, `GET /notes` e `GET /notes/:id`
- pool de conexão SDK → linkd habilitado
- índices em `created_at` para as listagens ordenadas

Variáveis opcionais:

```bash
LINKD_DB_POOL_ENABLED=true
LINKD_DB_POOL_SIZE=3
LINKD_HTTP_CACHE_ENABLED=true
LINKD_HTTP_CACHE_TTL_SECONDS=300
LINKD_HTTP_CACHE_DETAIL_TTL_SECONDS=300
LINKD_HTTP_CACHE_MAX_ENTRIES=1000
```

## Endpoints

```
GET  /users          — lista usuários (cacheável)
POST /users          — cria usuário e invalida cache
GET  /notes          — lista notas (cacheável)
POST /notes          — cria nota e invalida cache
GET  /notes/:id      — busca nota por id (cacheável)
DELETE /notes/:id    — remove nota e invalida cache
```

## Pré-requisitos

- linkd rodando (`tcp://localhost:9999` ou configurar `LINKD_CONNECT`)
- database provisionado via `mtpx db database create`
- `LINKD_DATABASE_NAME` no `.env`
