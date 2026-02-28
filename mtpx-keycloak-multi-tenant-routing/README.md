# mtpx-keycloak-multi-tenant-routing

Exemplo enxuto de:

- autenticacao multi-tenant com Keycloak
- resolucao automatica do realm pelo host (`realm1.localhost`, `realm2.localhost`)
- queries sem tenant explicito no app
- roteamento automatico do banco pelo `sdk` + `linkd` usando `tenant_id` do token

O ponto central deste exemplo e:

1. o SDK resolve `ctx.tenant.realm` pelo host
2. o Keycloak emite `tenant_id` no access token
3. o `linkd` converte esse claim em `ctx.user.tenantId`
4. o SDK usa `ctx.user.tenantId` para selecionar o database do request
5. o codigo do app continua fazendo apenas `ctx.db.table(...).get()/insert()`

## Arquitetura do exemplo

```
realm1.localhost -> realm = realm1 -> token tenant_id = local-pg-realm1 -> DB local-pg-realm1
realm2.localhost -> realm = realm2 -> token tenant_id = local-pg-realm2 -> DB local-pg-realm2
```

O app nao passa tenant para as queries. O banco certo e escolhido antes da query executar.
Tambem existe uma protecao explicita no app: se o host resolver `realm1` e o bearer token for de `realm2` (ou vice-versa), a request autenticada e rejeitada com `403`.

## Pre-requisitos

- Bun
- Docker
- `linkd` rodando localmente
- `mtpx-cli` disponivel no workspace

## 1. Adicione os hosts locais

Adicione ao seu `/etc/hosts`:

```bash
127.0.0.1 realm1.localhost
127.0.0.1 realm2.localhost
```

## 2. Suba a infraestrutura

Use o dev-infra do workspace:

```bash
cd /path/to/multpex-framework/mtpx-framework-dev-infra
docker compose -f docker-compose-full.yml up -d pg redis nats keycloak
```

## 3. Suba o linkd com o client secret dos realms `realm1`/`realm2`

Este exemplo usa o client `multpex-services` nos dois realms. Como o login/refresh do `linkd`
usa OIDC estatico, suba o processo local com o secret correto:

```bash
cd /path/to/multpex-framework/linkd
LINKD_OIDC__ISSUER_URL=http://localhost:8180 \
LINKD_OIDC__REALM=realm1 \
LINKD_OIDC__CLIENT_ID=multpex-services \
LINKD_OIDC__CLIENT_SECRET=multpex \
cargo run
```

Observacao:

- a validacao JWT ja pode ser dinamica por issuer no `linkd.toml` local
- o realm estatico acima so serve como base para operacoes OIDC como `login`

## 4. Provisione os bancos dos tenants

Este exemplo usa databases fisicos diferentes para cada tenant autenticado:

- `local-pg-realm1`
- `local-pg-realm2`

Cadastre o server e provisione os dois bancos com o CLI:

```bash
cd /path/to/multpex-framework/mtpx-cli
mtpx db server add local-pg --dialect postgresql --host localhost --runtime-host postgres --port 5432 --admin-user postgres --admin-password postgres
mtpx provision local-pg-realm1 --server local-pg
mtpx provision local-pg-realm2 --server local-pg
```

Quando o `linkd` roda em Docker e o CLI roda no host, use:

- `--host localhost` para o CLI conseguir provisionar no Postgres local
- `--runtime-host postgres` para a credencial gravada no keystore funcionar dentro do container do `linkd`

## 5. Rode o exemplo

```bash
cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-keycloak-multi-tenant-routing
cp .env.example .env
bun install
bun run dev
```

`DEFAULT_AUTH_REALM` existe apenas como fallback quando a request nao trouxer tenant por host, header ou body.
Para `realm1.localhost` e `realm2.localhost`, o SDK continua resolvendo o realm a partir do host.

## 6. Usuarios disponiveis apos o seed

Logo apos rodar `./seed.sh`, estes usuarios ja existem:

- `realm1`: `user1 / password1`
- `realm1`: `admin1 / admin`
- `realm2`: `user2 / password2`
- `realm2`: `admin2 / admin`

O environment da collection Postman usa esses usuarios seeded por padrao.

## 7. Opcional: crie usuarios extras com `mtpx`

Os realms agora incluem um client admin dedicado:

- client id: `mtpx-admin-cli`
- client secret: `multpex`

Use esse client para criar usuarios extras, se voce quiser testar identidades separadas da seed:

```bash
cd /path/to/multpex-framework/mtpx-cli

bun run src/index.ts keycloak users create \
  --service-account \
  --url http://localhost:8180 \
  --realm realm1 \
  --client-id mtpx-admin-cli \
  --client-secret multpex \
  --username postman-realm1 \
  --email postman-realm1@example.local \
  --first-name Postman \
  --last-name Realm1 \
  --password Postman@123

bun run src/index.ts keycloak users create \
  --service-account \
  --url http://localhost:8180 \
  --realm realm2 \
  --client-id mtpx-admin-cli \
  --client-secret multpex \
  --username postman-realm2 \
  --email postman-realm2@example.local \
  --first-name Postman \
  --last-name Realm2 \
  --password Postman@123
```

Se o Keycloak ja estava rodando antes desta mudanca de seed, recrie/importe os realms antes de executar os comandos acima.

Base URL:

- `http://realm1.localhost:3000`
- `http://realm2.localhost:3000`

## Endpoints

### Health

```bash
curl http://realm1.localhost:3000/tenant-routing/health
```

### Discovery por realm

```bash
curl http://realm1.localhost:3000/tenant-routing/auth/discovery
curl http://realm2.localhost:3000/tenant-routing/auth/discovery
```

### Login no realm1

```bash
curl -X POST http://realm1.localhost:3000/tenant-routing/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user1",
    "password": "password1"
  }'
```

### Login no realm2

```bash
curl -X POST http://realm2.localhost:3000/tenant-routing/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user2",
    "password": "password2"
  }'
```

O retorno inclui um `tokenPreview` com os claims mais importantes:

- `iss` -> issuer do realm correto
- `tenant` -> tenant de autenticacao (`realm1` ou `realm2`)
- `tenantId` -> tenant de banco (`local-pg-realm1` ou `local-pg-realm2`)

## Fluxo de demonstracao

### 1. Gere os tokens

```bash
TOKEN_REALM1=$(curl -s -X POST http://realm1.localhost:3000/tenant-routing/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user1","password":"password1"}' | jq -r '.accessToken')

TOKEN_REALM2=$(curl -s -X POST http://realm2.localhost:3000/tenant-routing/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user2","password":"password2"}' | jq -r '.accessToken')
```

### 2. Inspecione contexto + banco atual

```bash
curl http://realm1.localhost:3000/tenant-routing/context \
  -H "Authorization: Bearer $TOKEN_REALM1"

curl http://realm2.localhost:3000/tenant-routing/context \
  -H "Authorization: Bearer $TOKEN_REALM2"
```

O esperado:

- `realm1.localhost` retorna `realm = realm1`
- `realm2.localhost` retorna `realm = realm2`
- `userTenantId` e `currentDatabase` mudam entre `local-pg-realm1` e `local-pg-realm2`

### 2.1. Token de outro realm deve ser rejeitado

```bash
curl http://realm1.localhost:3000/tenant-routing/context \
  -H "Authorization: Bearer $TOKEN_REALM2"
```

O esperado:

- status `403`
- mensagem informando `Cross-tenant token rejected`

### 3. Grave uma nota em cada tenant

```bash
curl -X POST http://realm1.localhost:3000/tenant-routing/notes \
  -H "Authorization: Bearer $TOKEN_REALM1" \
  -H "Content-Type: application/json" \
  -d '{"message":"nota criada no tenant realm1"}'

curl -X POST http://realm2.localhost:3000/tenant-routing/notes \
  -H "Authorization: Bearer $TOKEN_REALM2" \
  -H "Content-Type: application/json" \
  -d '{"message":"nota criada no tenant realm2"}'
```

### 4. Liste em cada host e verifique o isolamento

```bash
curl http://realm1.localhost:3000/tenant-routing/notes \
  -H "Authorization: Bearer $TOKEN_REALM1"

curl http://realm2.localhost:3000/tenant-routing/notes \
  -H "Authorization: Bearer $TOKEN_REALM2"
```

Cada host deve enxergar apenas as notas do seu proprio banco.

## Usuarios disponiveis

### realm1

- `user1 / password1` seed nativo do realm
- `admin1 / admin` seed nativo do realm
- `postman-realm1 / Postman@123` opcional via `mtpx keycloak users create`

### realm2

- `user2 / password2` seed nativo do realm
- `admin2 / admin` seed nativo do realm
- `postman-realm2 / Postman@123` opcional via `mtpx keycloak users create`

## O que o codigo demonstra

- `ctx.tenant.realm` resolvido automaticamente pelo host
- `ctx.auth` configurado por request para o realm certo
- `ctx.user.tenantId` vindo do token validado pelo `linkd`
- `ctx.db.raw("SELECT current_database() ...")` confirmando o banco roteado
- `ctx.db.table("tenant_notes")...` sem `use(database)` e sem header `x-tenant-id`
- requests autenticadas falhando com `403` quando o host e o token pertencem a realms diferentes

## Troubleshooting

### `invalid_client` no login

Suba o `linkd` com:

```bash
LINKD_OIDC__CLIENT_SECRET=multpex
```

### `403 Forbidden` ao usar `mtpx keycloak ... --service-account`

Use o client admin dedicado:

```bash
--client-id mtpx-admin-cli --client-secret multpex
```

Se o realm foi importado antes desta mudanca, reimporte/recrie o Keycloak para que o client admin passe a existir.

### `Database not found` ou falha de autenticacao no banco

Confira se os tenants foram provisionados:

```bash
cd /path/to/multpex-framework/mtpx-cli
mtpx provision local-pg-realm1 --server local-pg
mtpx provision local-pg-realm2 --server local-pg
```

### `403 Cross-tenant token rejected`

O host e o token precisam pertencer ao mesmo realm:

- `realm1.localhost` aceita apenas token emitido por `realm1`
- `realm2.localhost` aceita apenas token emitido por `realm2`

### `Could not resolve host`

Faltam as entradas `realm1.localhost` e `realm2.localhost` no `/etc/hosts`.
