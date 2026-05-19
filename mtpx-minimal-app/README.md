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

- TCP local: `LINKD_CONNECT=tcp://localhost:9999` com a sessão atual do `mtpx login` (recomendado para host -> Docker)
- TCP staging (público, via NLB + Istio Gateway, TLS terminado na NLB): `LINKD_CONNECT=tcps://linkd.stg.k8s.multpex.com.br:9999`
- Unix socket: `LINKD_CONNECT=unix:///tmp/linkd.sock` (quando o linkd roda local no host)

## Autenticação HTTP

- Os endpoints protegidos do exemplo usam `AUTH_REALM=multpex`
- O `client_id` esperado para os tokens do app é `multpex-services`
- Um token válido do realm `multpex` deve funcionar em `POST /minimal-app/items` e nos endpoints admin, sem cair em fallback para `default`

Se o linkd estiver em Docker no macOS, prefira TCP.

## Modo staging (linkd no k8s)

O linkd de staging é exposto publicamente via NLB + Istio Gateway. Convenção de portas: `9999` com TLS terminado na NLB (cert ACM `*.stg.k8s.multpex.com.br`) e `9998` em TCP plain. A autenticação acontece na camada do protocolo (JWT do realm `staging-multpex` validado contra o JWKS do Keycloak). Nada de port-forward.

1. Faça login na CLI contra o realm de staging:

   ```bash
   mtpx login \
     --server https://keycloak.api.gmstg.multipex.com.br/auth \
     --realm staging-multpex \
     --client-id web-client
   ```

2. Ajuste o `.env`:

   ```bash
   LINKD_CONNECT=tcps://linkd.stg.k8s.multpex.com.br:9999
   AUTH_REALM=staging-multpex
   AUTH_CLIENT_ID=web-client
   ```

   Se existir `LINKD_CONNECT` exportado no shell, ele tem precedência sobre o `.env`. Confira com `echo $LINKD_CONNECT` ou rode `unset LINKD_CONNECT` antes de subir o app.

3. Suba o app:

   ```bash
   bun run dev
   ```

O mesmo JWT emitido pelo `mtpx login` é usado pelo handshake TCP do SDK e pelos endpoints HTTP protegidos do exemplo.

> Se você quiser bypass do gateway (debug em uma rota individual), o helper antigo `../scripts/portforward-staging.sh` continua funcionando — mas não é mais necessário para o fluxo padrão.

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
