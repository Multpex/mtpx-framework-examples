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
realm1.localhost -> realm = realm1 -> token tenant_id = local_pg_realm1 -> DB local_pg_realm1
realm2.localhost -> realm = realm2 -> token tenant_id = local_pg_realm2 -> DB local_pg_realm2
```

O app nao passa tenant para as queries. O banco certo e escolhido antes da query executar.
Tambem existe uma protecao explicita no app: se o host resolver `realm1` e o bearer token for de `realm2` (ou vice-versa), a request autenticada e rejeitada com `403`.

## Pre-requisitos

- Bun
- Docker
- `mtpx` instalado e autenticado

## Setup do zero

Siga exatamente esta ordem para deixar o exemplo 100% funcional.

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

docker compose -f docker-compose-full.yml down -v --remove-orphans

LINKD_KEYSTORE_ENCRYPTION_KEY="bXVsdHBleG11bHRwZXhtdWx0cGV4bXVsdHBleDEyMzQ=" \
docker compose -f docker-compose-full.yml --profile elasticsearch up -d
```

O `docker-compose-full.yml` ja sobe:

- Postgres
- Redis
- NATS
- Keycloak
- Elasticsearch
- `linkd`

O `linkd` do compose completo ja vem alinhado com OIDC/JWKS do Keycloak. Nao e necessario subir outro `linkd` local para este exemplo.

## 3. Rode o seed

Ainda no repo `mtpx-framework-dev-infra`:

```bash
LINKD_KEYSTORE_ENCRYPTION_KEY="bXVsdHBleG11bHRwZXhtdWx0cGV4bXVsdHBleDEyMzQ=" \
./seed.sh
```

## 4. Renove e valide a sessao da CLI

```bash
mtpx logout
mtpx login
mtpx whoami
```

Importante:

- a conexao TCP do app com o `linkd` usa o token salvo pela CLI em `mtpx login`
- esse token deve vir do realm padrao `multpex`
- os realms `realm1` e `realm2` sao usados para os endpoints HTTP do exemplo, nao para autenticar o socket TCP do app
- depois de rodar `seed.sh` ou recriar os realms do Keycloak, rode `mtpx login` de novo para renovar a sessao local

## 5. Valide o keystore antes de provisionar

```bash
mtpx keystore info
mtpx keystore list
```

O esperado:

- `Enabled: true`
- `Supports namespaces: true`

## 6. Cadastre o server de banco corretamente

Este exemplo usa databases fisicos diferentes para cada tenant autenticado:

- `local_pg_realm1`
- `local_pg_realm2`

Cadastre um server profile com host de admin no host e host de runtime dentro do Docker:

```bash
mtpx db server add docker-pg \
  --dialect postgresql \
  --host localhost \
  --runtime-host postgres \
  --port 5432 \
  --admin-user multpex \
  --admin-password multpex
```

Use:

- `--host localhost` para a CLI conectar no Postgres exposto no host
- `--runtime-host postgres` para a credencial gravada no keystore funcionar dentro do container do `linkd`

Nao use `localhost` como `runtime-host` quando o `linkd` estiver em Docker.

Se ja houver um cadastro errado anterior, remova e recrie:

```bash
mtpx db server remove docker-pg
```

## 7. Provisione os bancos dos tenants

```bash
mtpx provision local_pg_realm1 --server docker-pg
mtpx provision local_pg_realm2 --server docker-pg
```

Os nomes corretos sao com underscore:

- `local_pg_realm1`
- `local_pg_realm2`

Nao use mais:

- `local-pg-realm1`
- `local-pg-realm2`

## 8. Rode o exemplo

```bash
cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-keycloak-multi-tenant-routing
cp .env.example .env
bun install
bun run dev
```

`DEFAULT_AUTH_REALM` existe apenas como fallback quando a request nao trouxer tenant por host, header ou body.
Para `realm1.localhost` e `realm2.localhost`, o SDK continua resolvendo o realm a partir do host.

## 9. Usuarios disponiveis apos o seed

Logo apos rodar `./seed.sh`, estes usuarios ja existem:

- `realm1`: `user1 / password1`
- `realm1`: `admin1 / admin`
- `realm2`: `user2 / password2`
- `realm2`: `admin2 / admin`

O environment da collection Postman usa esses usuarios seeded por padrao.

## 10. Opcional: crie usuarios extras com `mtpx`

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

## 11. Checklist de validacao

O ambiente esta correto quando:

- `mtpx whoami` funciona
- `mtpx db server list` funciona
- `mtpx provision local_pg_realm1 --server docker-pg` funciona
- `mtpx provision local_pg_realm2 --server docker-pg` funciona
- login em `realm1.localhost` retorna token
- login em `realm2.localhost` retorna token
- `GET /tenant-routing/context` em `realm1.localhost` mostra `userTenantId = local_pg_realm1` e `currentDatabase = local_pg_realm1`
- `GET /tenant-routing/context` em `realm2.localhost` mostra `userTenantId = local_pg_realm2` e `currentDatabase = local_pg_realm2`
- token de `realm2` em `realm1.localhost` e rejeitado
- token de `realm1` em `realm2.localhost` e rejeitado

## 12. Ordem rapida de comandos

Se voce quer apenas o caminho curto que funcionou limpo no fim desta sessao:

```bash
cd /path/to/multpex-framework/mtpx-framework-dev-infra

docker compose -f docker-compose-full.yml down -v --remove-orphans

LINKD_KEYSTORE_ENCRYPTION_KEY="bXVsdHBleG11bHRwZXhtdWx0cGV4bXVsdHBleDEyMzQ=" \
docker compose -f docker-compose-full.yml --profile elasticsearch up -d

LINKD_KEYSTORE_ENCRYPTION_KEY="bXVsdHBleG11bHRwZXhtdWx0cGV4bXVsdHBleDEyMzQ=" \
./seed.sh

mtpx logout
mtpx login

mtpx db server remove docker-pg || true

mtpx db server add docker-pg \
  --dialect postgresql \
  --host localhost \
  --runtime-host postgres \
  --port 5432 \
  --admin-user multpex \
  --admin-password multpex

mtpx provision local_pg_realm1 --server docker-pg
mtpx provision local_pg_realm2 --server docker-pg

cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-keycloak-multi-tenant-routing
cp .env.example .env
bun install
bun run dev
```

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
- `tenantId` -> tenant de banco (`local_pg_realm1` ou `local_pg_realm2`)

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
- `userTenantId` e `currentDatabase` mudam entre `local_pg_realm1` e `local_pg_realm2`

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
mtpx provision local_pg_realm1 --server docker-pg
mtpx provision local_pg_realm2 --server docker-pg
```

Tambem confirme que o `db-server` foi cadastrado com:

- `--host localhost`
- `--runtime-host postgres`

### `403 Cross-tenant token rejected`

O host e o token precisam pertencer ao mesmo realm:

- `realm1.localhost` aceita apenas token emitido por `realm1`
- `realm2.localhost` aceita apenas token emitido por `realm2`

### `Could not resolve host`

Faltam as entradas `realm1.localhost` e `realm2.localhost` no `/etc/hosts`.

### `Invalid token` na subida do app

Quase sempre e um destes casos:

- faltou rodar `mtpx logout && mtpx login` depois do `seed.sh`
- o app ainda esta usando uma versao antiga do SDK

Reinstale as dependencias do app se necessario:

```bash
rm -rf node_modules bun.lock
bun install
```

### `JWKS error` tentando acessar `localhost:8080`

Recrie `keycloak` e `linkd` com o compose atualizado:

```bash
cd /path/to/multpex-framework/mtpx-framework-dev-infra

LINKD_KEYSTORE_ENCRYPTION_KEY="bXVsdHBleG11bHRwZXhtdWx0cGV4bXVsdHBleDEyMzQ=" \
docker compose -f docker-compose-full.yml up -d --force-recreate keycloak linkd
```
