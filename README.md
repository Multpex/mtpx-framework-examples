# mtpx-framework-examples

Colecao de exemplos oficiais do ecossistema Multpex.

Cada pasta neste repositorio mostra um caso de uso pratico do `@multpex/typescript-sdk`.

## Exemplos disponiveis

| Projeto | Objetivo | README |
|---|---|---|
| `mtpx-minimal-app` | Servico minimo com actions HTTP e testes basicos | `mtpx-minimal-app/README.md` (quando aplicavel) |
| `mtpx-micro-services` | Arquitetura estilo microservicos com loader, eventos e banco | `mtpx-micro-services/README.md` |
| `mtpx-auth-rbac` | Autenticacao e autorizacao (RBAC) com roles | `mtpx-auth-rbac/README.md` |
| `mtpx-graphql-service` | Exposicao/consumo GraphQL no ecossistema | `mtpx-graphql-service/README.md` |
| `mtpx-msg-channels` | Diferenca entre `emit` e `sendToChannel` | `mtpx-msg-channels/README.md` |
| `mtpx-scheduled-jobs` | Jobs agendados, scheduler e worker | `mtpx-scheduled-jobs/README.md` |
| `mtpx-websocket-chat` | Exemplo de API WebSocket do SDK | `mtpx-websocket-chat/README.md` |

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

## Fluxo recomendado de exploracao

1. Comece em `mtpx-minimal-app`
2. Depois avance para `mtpx-micro-services`
3. Explore `mtpx-auth-rbac` e `mtpx-graphql-service`
4. Siga para `mtpx-msg-channels` e `mtpx-scheduled-jobs`
5. Por fim, veja `mtpx-websocket-chat`

## Observacoes

- Este repositorio contem apenas exemplos. Codigo de SDK e sidecar estao em repositorios/pastas proprias.
- O exemplo `mtpx-websocket-chat` documenta o estado atual do suporte WebSocket no ambiente.
