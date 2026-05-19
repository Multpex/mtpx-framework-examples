# mtpx-framework-examples

Colecao de exemplos do ecossistema Multpex Framework, demonstrando casos de uso práticos e integrações comuns.

Cada pasta neste repositorio mostra um caso de uso pratico do `@linkd/sdk-typescript`.

## Exemplos disponiveis

| Projeto | Objetivo | README |
|---|---|---|
| [mtpx-minimal-app](./mtpx-minimal-app) | Servico minimo com actions HTTP e testes basicos | [Abrir](./mtpx-minimal-app/README.md) |
| [mtpx-micro-services](./mtpx-micro-services) | Arquitetura estilo microservicos com loader, eventos, banco e migrations multi-tenant via CLI | [Abrir](./mtpx-micro-services/README.md) |
| [mtpx-auth-rbac](./mtpx-auth-rbac) | Autenticacao e autorizacao (RBAC) com roles | [Abrir](./mtpx-auth-rbac/README.md) |
| [mtpx-keycloak-multi-tenant-routing](./mtpx-keycloak-multi-tenant-routing) | Keycloak com dois realms, host-based realm resolution e roteamento automatico de banco por tenant | [Abrir](./mtpx-keycloak-multi-tenant-routing/README.md) |
| [mtpx-keycloak-admin-basics](./mtpx-keycloak-admin-basics) | Operacoes basicas de administracao do Keycloak (users/roles) | [Abrir](./mtpx-keycloak-admin-basics/README.md) |
| [mtpx-graphql-service](./mtpx-graphql-service) | Exposicao/consumo GraphQL no ecossistema | [Abrir](./mtpx-graphql-service/README.md) |
| [mtpx-msg-channels](./mtpx-msg-channels) | Diferenca entre `emit` e `sendToChannel` | [Abrir](./mtpx-msg-channels/README.md) |
| [mtpx-scheduled-jobs](./mtpx-scheduled-jobs) | Jobs agendados, scheduler e worker | [Abrir](./mtpx-scheduled-jobs/README.md) |
| [mtpx-websocket-chat](./mtpx-websocket-chat) | Exemplo de API WebSocket do SDK | [Abrir](./mtpx-websocket-chat/README.md) |
| [mtpx-db-env-selector](./mtpx-db-env-selector) | Seleciona database via env var e valida credencial no keystore | [Abrir](./mtpx-db-env-selector/src/index.ts) |
| [mtpx-fluent-v2-lambda](./mtpx-fluent-v2-lambda) | Exemplo focado em `where((...) => ...)`, joins com lambda e fallback para `whereExpr(...)` | [Abrir](./mtpx-fluent-v2-lambda/README.md) |

## Pre-requisitos

- Bun
- Docker + Docker Compose
- Rust (para rodar o `linkd` localmente)

## Setup compartilhado (uma vez)

### 1. Subir infraestrutura

Use o repositorio `mtpx-framework-dev-infra`:

```bash
cd /path/to/multpex-framework/mtpx-framework-dev-infra
docker compose up -d
```

Para cenarios com Keycloak/Elasticsearch, use:

```bash
docker compose -f docker-compose-full.yml up -d
```

### 2. Subir o linkd

```bash
cd /path/to/multpex-framework/linkd
cargo run
```

## Executando um exemplo

Padrao geral:

```bash
cd /path/to/multpex-framework/mtpx-framework-examples/<nome-do-exemplo>
bun install
bun run dev
```

Alguns exemplos usam scripts adicionais (`worker`, `test`, `postman:test`, etc). Veja o `package.json` e o `README.md` de cada pasta.

### Nota sobre encerramento dos apps

`createApp`, `createService` e `startServices(...)` já configuram graceful shutdown automaticamente via SDK.

- Sinais suportados: `SIGINT` e `SIGTERM`
- `Ctrl+C` encerra os serviços de forma ordenada

## Collections (Postman)

Cada exemplo tem arquivos em `postman/*.postman_collection.json` e `postman/*.postman_environment.json`.

### Autenticação (staging)

As collections que falam com `linkd.stg.k8s.multpex.com.br` autenticam contra o realm `staging-multpex` no Keycloak via **OAuth2 Authorization Code + PKCE** (SSO). Como o Postman não suporta SSO diretamente sem registrar `https://oauth.pstmn.io/v1/callback` como Valid Redirect URI no `web-client`, as collections usam um **fluxo de refresh-token** pré-configurado:

1. No terminal, autentique-se com o CLI: `mtpx login` (abre o browser, faz SSO).
2. Copie o `refreshToken` de `~/.multpex/cli/.credentials.yaml` (perfil `default`).
3. No Postman, abra o environment do exemplo → coluna **Current Value** da variável `refreshToken` → cole o token.
4. Rode qualquer request — um pre-request script da collection troca o `refreshToken` por um `accessToken` válido automaticamente e o renova quando expira.

> ⚠️ O refresh token expira em ~7h (lifetime do realm). Quando isso acontecer, repita o `mtpx login` e cole o novo `refreshToken`.
>
> Alternativa futura: cadastrar `https://oauth.pstmn.io/v1/callback` como Valid Redirect URI do `web-client` no Keycloak e usar o suporte nativo a OAuth 2.0 do Postman (Authorization Code + PKCE) na aba *Authorization* da collection.
