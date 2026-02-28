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
  --admin-password multpex \
  --admin-database multpex
```

Flags obrigatorias:

- `--host localhost` — para a CLI conectar no Postgres exposto no host
- `--runtime-host postgres` — para a credencial gravada no keystore funcionar dentro do container do `linkd`. **Sem essa flag, o `linkd` dockerizado tenta conectar em `localhost` dentro do proprio container e falha.**
- `--admin-database multpex` — para a CLI criar a tabela `_system_secrets` no mesmo database que o `linkd` usa como default (`multpex`). **Sem essa flag, o default e `postgres` e o linkd nao encontra o secret para derivar as senhas dos tenants.**

Se ja houver um cadastro errado anterior, remova e recrie:

```bash
mtpx db server remove docker-pg
```

Para validar o cadastro:

```bash
mtpx db server list
```

O esperado: `docker-pg` com `runtimeHost = postgres` e `adminDatabase = multpex`.

## 7. Provisione os bancos dos tenants

```bash
mtpx provision local_pg_realm1 --server docker-pg
mtpx provision local_pg_realm2 --server docker-pg
```

Valide a saida do provision. O esperado:

- `Runtime Host: postgres` (nao `localhost`)
- `Dialect: postgresql`

Se `Runtime Host` mostrar `localhost`, o `docker-pg` foi cadastrado sem `--runtime-host postgres`. Remova e recadastre:

```bash
mtpx db server remove docker-pg
# repita o passo 6 com --runtime-host postgres
mtpx provision local_pg_realm1 --server docker-pg
mtpx provision local_pg_realm2 --server docker-pg
```

Depois de provisionar, reinicie o container do `linkd` para forcar o keystore watcher a sincronizar:

```bash
cd /path/to/multpex-framework/mtpx-framework-dev-infra
docker compose -f docker-compose-full.yml restart linkd
```

Para listar os bancos provisionados:

```bash
mtpx provision list
```

## 8. Rode o exemplo

```bash
cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-keycloak-multi-tenant-routing
cp .env.example .env
bun install
bun run dev
```

## 9. Teste com o Postman

Importe a collection do Postman em `postman/` (se disponivel) ou teste manualmente:

```bash
# Health check (sem auth)
curl http://localhost:3000/tenant-routing/health

# Discovery do realm1
curl http://realm1.localhost:3000/tenant-routing/auth/discovery

# Login no realm1 (obtem access token)
curl -X POST http://realm1.localhost:3000/tenant-routing/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "user1", "password": "user1"}'

# Contexto autenticado (use o access token recebido)
curl http://realm1.localhost:3000/tenant-routing/context \
  -H 'Authorization: Bearer <access_token>'
```