# GraphQL Service Example

Demonstra como usar GraphQL no ecossistema Multpex:
1. Definir actions com metadata GraphQL para exposição automática
2. Usar o GraphQL Client para consumir APIs externas
3. Expor subscriptions via WebSocket (`graphql-transport-ws`)

## Como Funciona

O linkd automaticamente gera um schema GraphQL unificado baseado em todas as actions registradas que possuem metadata `graphql`. Não é necessário configurar um servidor GraphQL separado.
## Pré-requisitos

```bash
# 1. Subir infraestrutura compartilhada
git clone https://github.com/Multpex/mtpx-framework-dev-infra.git
cd /path/to/mtpx-framework-dev-infra
docker compose up -d pg nats redis

# 2. Rodar o Linkd (em outro terminal)
cd /path/to/multpex-framework/linkd
cargo run
```

## Executando

```bash
cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-graphql-service
bun install
bun run dev
```

## OIDC no linkd

Use OIDC configurado no linkd (`[oidc]` no `linkd.toml` ou `LINKD_OIDC__*` por ambiente).

## Endpoints

### REST + GraphQL

```bash
# Health check
curl http://localhost:3000/graphql-example/health

# REST: Listar livros
curl http://localhost:3000/graphql-example/books

# REST: Buscar livro por ID
curl http://localhost:3000/graphql-example/books/1

# REST: Buscar por autor
curl http://localhost:3000/graphql-example/books/author/Robert
```

### GraphQL Queries

```bash
# O endpoint GraphQL é exposto pelo linkd
# Exemplo de query via curl:
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ books { id title author year } }"}'

# Query com variáveis
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query GetBook($id: ID!) { book(id: $id) { id title author } }",
    "variables": { "id": "1" }
  }'
```

### GraphQL Mutations

```bash
# Criar livro (requer role editor ou admin)
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "query": "mutation CreateBook($input: CreateBookInput!) { createBook(input: $input) { id title } }",
    "variables": {
      "input": {
        "title": "Design Patterns",
        "author": "Gang of Four",
        "year": 1994
      }
    }
  }'
```

### GraphQL Subscriptions (WebSocket)

Endpoint WS do linkd:

```text
ws://localhost:3000/graphql/ws
```

Fluxo (`graphql-transport-ws`):

1. `connection_init`
2. `connection_ack`
3. `subscribe` com query GraphQL

Exemplo de subscription:

```graphql
subscription {
  bookCreated {
    bookId
    title
    author
    year
  }
}
```

## Definindo GraphQL Metadata

### Query

```typescript
import { gqlQuery, GQL } from "@multpex/sdk-typescript";

service.action("books.get", {
  route: "/books/:id",
  method: "GET",
  graphql: gqlQuery({
    description: "Busca um livro pelo ID",
    args: {
      id: { type: GQL.ID, required: true }
    },
    returnType: { type: "Book", required: false }
  })
}, handler);
```

### Mutation

```typescript
import { gqlMutation } from "@multpex/sdk-typescript";

service.action("books.create", {
  route: "/books",
  method: "POST",
  graphql: gqlMutation({
    args: {
      input: { type: "CreateBookInput", required: true }
    },
    returnType: { type: "Book", required: true }
  })
}, handler);
```

### Subscription

```typescript
import { gqlSubscription } from "@multpex/sdk-typescript";

service.action("books.stream.created", {
  route: "/books/events/created",
  method: "GET",
  graphql: gqlSubscription({
    fieldName: "bookCreated",
    streamKind: "event",
    streamPattern: "book.created",
    returnType: { type: "BookCreatedEvent", required: true },
  }),
}, handler);
```

### Tipos Customizados

```typescript
import { gqlType, gqlInput, GQL } from "@multpex/sdk-typescript";

const app = createApp({
  graphql: {
    enabled: true,
    types: [
      // Output type
      gqlType("Book", {
        id: { type: GQL.ID, required: true },
        title: { type: GQL.String, required: true },
        author: { type: GQL.String, required: true },
      }),
      // Input type
      gqlInput("CreateBookInput", {
        title: { type: GQL.String, required: true },
        author: { type: GQL.String, required: true },
      }),
    ],
  },
});
```

## Consumindo APIs GraphQL Externas

```typescript
import { createGraphQLClient } from "@multpex/sdk-typescript";

const client = createGraphQLClient({
  endpoint: "https://api.example.com/graphql",
  headers: {
    Authorization: "Bearer xxx",
  },
});

// Query
const result = await client.query<{ users: User[] }>(`
  query { users { id name } }
`);

// Query com variáveis
const user = await client.query<{ user: User }>(
  `query GetUser($id: ID!) { user(id: $id) { id name } }`,
  { id: "123" }
);

// Mutation
await client.mutate<{ createUser: User }>(
  `mutation CreateUser($input: UserInput!) { createUser(input: $input) { id } }`,
  { input: { name: "John" } }
);
```

## Tipos Escalares GQL

| Tipo | Descrição |
|------|-----------|
| `GQL.ID` | Identificador único |
| `GQL.String` | String |
| `GQL.Int` | Inteiro |
| `GQL.Float` | Ponto flutuante |
| `GQL.Boolean` | Booleano |
| `"CustomType"` | Tipo customizado definido em `graphql.types` |
