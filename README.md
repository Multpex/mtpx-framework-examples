# mtpx-framework-examples

Colecao de exemplos oficiais do ecossistema Multpex.

Cada pasta neste repositorio mostra um caso de uso pratico do `@multpex/typescript-sdk`.

## Exemplos disponiveis

| Projeto | Objetivo | README |
|---|---|---|
| [mtpx-minimal-app](./mtpx-minimal-app) | Servico minimo com actions HTTP e testes basicos | [Abrir](./mtpx-minimal-app/README.md) |
| [mtpx-micro-services](./mtpx-micro-services) | Arquitetura estilo microservicos com loader, eventos e banco | [Abrir](./mtpx-micro-services/README.md) |
| [mtpx-auth-rbac](./mtpx-auth-rbac) | Autenticacao e autorizacao (RBAC) com roles | [Abrir](./mtpx-auth-rbac/README.md) |
| [mtpx-graphql-service](./mtpx-graphql-service) | Exposicao/consumo GraphQL no ecossistema | [Abrir](./mtpx-graphql-service/README.md) |
| [mtpx-msg-channels](./mtpx-msg-channels) | Diferenca entre `emit` e `sendToChannel` | [Abrir](./mtpx-msg-channels/README.md) |
| [mtpx-scheduled-jobs](./mtpx-scheduled-jobs) | Jobs agendados, scheduler e worker | [Abrir](./mtpx-scheduled-jobs/README.md) |
| [mtpx-websocket-chat](./mtpx-websocket-chat) | Exemplo de API WebSocket do SDK | [Abrir](./mtpx-websocket-chat/README.md) |
| [mtpx-db-env-selector](./mtpx-db-env-selector) | Seleciona database via env var e valida credencial no keystore | [Abrir](./mtpx-db-env-selector/src/index.ts) |

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

Exemplos que fazem bootstrap com `startServices(...)` usam `ServiceLoader`, que já configura graceful shutdown automaticamente via `setupGracefulShutdown`.

- Sinais suportados: `SIGINT` e `SIGTERM`
- `Ctrl+C` para os serviços carregados de forma ordenada

## Collections (Postman + Insomnia)

Cada exemplo continua com os arquivos oficiais em `postman/*.postman_collection.json` e `postman/*.postman_environment.json`.

Para gerar versoes separadas para Insomnia em todos os projetos, execute:

```bash
cd /path/to/multpex-framework/mtpx-framework-examples
node ./scripts/generate-insomnia-collections.mjs
```

Isso cria arquivos com sufixo:

- `*.insomnia.postman_collection.json`
- `*.insomnia.postman_environment.json`

## Fluxo recomendado de exploracao

1. Comece em `mtpx-minimal-app`
2. Depois avance para `mtpx-micro-services`
3. Explore `mtpx-auth-rbac` e `mtpx-graphql-service`
4. Siga para `mtpx-msg-channels` e `mtpx-scheduled-jobs`
5. Por fim, veja `mtpx-websocket-chat`

## Observacoes

- Este repositorio contem apenas exemplos. Codigo de SDK e sidecar estao em repositorios/pastas proprias.
- O exemplo `mtpx-websocket-chat` documenta o estado atual do suporte WebSocket no ambiente.
