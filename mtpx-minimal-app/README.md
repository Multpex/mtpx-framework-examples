# mtpx-minimal-app

Exemplo mínimo do `@linkd/sdk-typescript` com rotas básicas, autenticação em mutations e testes de integração.

## Pré-requisitos

- Bun
- `linkd` em execução

## Executar em desenvolvimento

```bash
bun install
bun run dev
```

## Modos de conexão com linkd

- TCP: `LINKD_CONNECT=tcp://localhost:9999` com a sessão atual do `mtpx login` (recomendado para host -> Docker)
- Unix socket: `LINKD_CONNECT=unix:///tmp/linkd.sock` (quando o linkd roda local no host)

## Autenticação HTTP

- Os endpoints protegidos do exemplo usam `AUTH_REALM=multpex`
- O `client_id` esperado para os tokens do app é `multpex-services`
- Um token válido do realm `multpex` deve funcionar em `POST /minimal-app/items` e nos endpoints admin, sem cair em fallback para `default`

Se o linkd estiver em Docker no macOS, prefira TCP.

## Modo staging (linkd no k8s)

Para rodar o app local apontando para o linkd do cluster de staging:

1. Em um terminal, abra o port-forward (o helper já cuida do contexto certo):

   ```bash
   ../scripts/portforward-staging.sh
   ```

   Isso expõe `linkd:9999` do namespace `linkd` (contexto `stg.k8s.multpex.com.br`) em `localhost:9999`.

2. Faça login na CLI contra o realm de staging:

   ```bash
   mtpx login \
     --server https://keycloak.api.gmstg.multipex.com.br/auth \
     --realm staging-multpex \
     --client-id web-client
   ```

3. Ajuste o `.env` para usar o realm de staging (`AUTH_REALM=staging-multpex`, `AUTH_CLIENT_ID=web-client`) e mantenha `LINKD_CONNECT=tcp://localhost:9999`.

4. Suba o app normalmente:

   ```bash
   bun run dev
   ```

O linkd em staging valida JWT contra o JWKS de `staging-multpex`, então o token emitido pelo `mtpx login` é o mesmo usado pelo TCP handshake e pelos endpoints HTTP protegidos.

## Executar em modo normal

```bash
bun run start
```

## Build

```bash
bun run build
bun run start:prod
```

## Testes

```bash
bun run test
```

Teste de integração específico:

```bash
bun run test:integration
```

## Testes Postman

```bash
bun run postman:test
```

## O que o exemplo demonstra

- Setup básico de serviço com SDK
- Endpoints HTTP com validação
- Integração com contexto (`ctx`) do framework
- Fluxo de testes automatizados (Bun + Postman)
