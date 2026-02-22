/**
 * GraphQL Service Example
 *
 * Este exemplo demonstra:
 * 1. Como definir actions com metadata GraphQL para exposição automática
 * 2. Como usar o GraphQL Client para consumir APIs externas
 *
 * O linkd automaticamente gera um schema GraphQL baseado nas actions
 * que possuem metadata GraphQL configurado.
 */

import {
  createService,
  setupGracefulShutdown,
  UnauthorizedError,
  z,
  StartupErrorHandler,
  env,
  // GraphQL helpers para definir metadata
  gqlQuery,
  gqlMutation,
  gqlSubscription,
  GQL,
  gqlType,
  gqlInput,
  // GraphQL Client para consumir APIs
  createGraphQLClient,
} from "@multpex/typescript-sdk";

// =============================================================================
// Schema Definitions
// =============================================================================

const createBookSchema = z.object({
  title: z.string().min(1).max(200),
  author: z.string().min(1).max(100),
  year: z.number().int().min(1000).max(2100),
  isbn: z.string().optional(),
});

type CreateBookInput = z.infer<typeof createBookSchema>;

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  realm: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

function authErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

interface Book {
  id: string;
  title: string;
  author: string;
  year: number;
  isbn?: string;
  createdAt: Date;
}

interface BookCreatedEvent {
  bookId: string;
  title: string;
  author: string;
  year: number;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

const books = new Map<string, Book>([
  [
    "1",
    {
      id: "1",
      title: "Clean Code",
      author: "Robert C. Martin",
      year: 2008,
      isbn: "978-0132350884",
      createdAt: new Date("2024-01-01"),
    },
  ],
  [
    "2",
    {
      id: "2",
      title: "The Pragmatic Programmer",
      author: "David Thomas & Andrew Hunt",
      year: 2019,
      isbn: "978-0135957059",
      createdAt: new Date("2024-01-02"),
    },
  ],
]);

// =============================================================================
// Service Setup
// =============================================================================

const service = createService({
  name: "graphql-example",
  logging: { level: "debug", pretty: true },
  auth: {
    enabled: true,
    realm: env.string("AUTH_REALM", "multpex"),
    clientId: env.string("AUTH_CLIENT_ID", "multpex-services"),
    knownRealms: ["multpex", "multpex-test", "realm1", "realm2"],
  },

  // Configuração GraphQL (opcional - linkd usa defaults sensatos)
  graphql: {
    enabled: true,
    // Os tipos são gerados automaticamente baseado nas actions
    // Ou podem ser definidos explicitamente:
    types: [
      gqlType("Book", {
        id: { type: GQL.ID, required: true },
        title: { type: GQL.String, required: true },
        author: { type: GQL.String, required: true },
        year: { type: GQL.Int, required: true },
        isbn: { type: GQL.String, required: false },
        createdAt: { type: GQL.String, required: true },
      }),
      gqlInput("CreateBookInput", {
        title: { type: GQL.String, required: true },
        author: { type: GQL.String, required: true },
        year: { type: GQL.Int, required: true },
        isbn: { type: GQL.String, required: false },
      }),
      gqlType("BookCreatedEvent", {
        bookId: { type: GQL.ID, required: true },
        title: { type: GQL.String, required: true },
        author: { type: GQL.String, required: true },
        year: { type: GQL.Int, required: true },
      }),
    ],
  },
});

// =============================================================================
// Auth Endpoints (mesmo padrão do mtpx-micro-services)
// =============================================================================

service.action(
  "auth.login",
  {
    route: "/auth/login",
    method: "POST",
    validate: loginSchema,
    graphql: gqlMutation({
      fieldName: "authLogin",
      description: "Autentica com username/password e retorna tokens",
      args: {
        username: { type: GQL.String, required: true },
        password: { type: GQL.String, required: true },
        realm: { type: GQL.String, required: false },
        clientId: { type: GQL.String, required: false },
      },
      returnType: { type: GQL.JSON, required: true },
    }),
  },
  async (ctx) => {
    const { username, password } = ctx.body as z.infer<typeof loginSchema>;
    if (!ctx.auth) {
      throw new UnauthorizedError("Authentication client is not available");
    }

    let result;
    try {
      result = await ctx.auth.login({ username, password });
    } catch (error) {
      ctx.logger.warn("Auth login failed", {
        username,
        tenant: ctx.tenant,
        error: authErrorMessage(error, "Authentication failed"),
      });
      throw new UnauthorizedError(authErrorMessage(error, "Authentication failed"));
    }

    if (!result.accessToken || !result.refreshToken) {
      throw new UnauthorizedError("Invalid login response from identity provider");
    }

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      refreshExpiresIn: result.refreshExpiresIn,
      tokenType: result.tokenType,
      user: result.user,
      tenant: ctx.tenant,
    };
  }
);

service.action(
  "auth.refresh",
  {
    route: "/auth/refresh",
    method: "POST",
    validate: refreshSchema,
    graphql: gqlMutation({
      fieldName: "authRefresh",
      description: "Renova access token usando refresh token",
      args: {
        refreshToken: { type: GQL.String, required: true },
      },
      returnType: { type: GQL.JSON, required: true },
    }),
  },
  async (ctx) => {
    const { refreshToken } = ctx.body as z.infer<typeof refreshSchema>;
    if (!ctx.auth) {
      throw new UnauthorizedError("Authentication client is not available");
    }

    let result;
    try {
      result = await ctx.auth.refresh(refreshToken);
    } catch (error) {
      ctx.logger.warn("Auth refresh failed", {
        tenant: ctx.tenant,
        error: authErrorMessage(error, "Authentication failed"),
      });
      throw new UnauthorizedError(authErrorMessage(error, "Authentication failed"));
    }

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      refreshExpiresIn: result.refreshExpiresIn,
      tokenType: result.tokenType,
    };
  }
);

service.action(
  "auth.logout",
  {
    route: "/auth/logout",
    method: "POST",
    auth: true,
    validate: logoutSchema,
    graphql: gqlMutation({
      fieldName: "authLogout",
      description: "Invalida sessão (logout) usando refresh token",
      args: {
        refreshToken: { type: GQL.String, required: true },
      },
      returnType: { type: GQL.JSON, required: true },
    }),
  },
  async (ctx) => {
    const { refreshToken } = ctx.body as z.infer<typeof logoutSchema>;
    if (!ctx.auth) {
      throw new UnauthorizedError("Authentication client is not available");
    }

    try {
      await ctx.auth.logout(refreshToken);
    } catch (error) {
      ctx.logger.warn("Auth logout failed", {
        userId: ctx.user?.id,
        tenant: ctx.tenant,
        error: authErrorMessage(error, "Authentication failed"),
      });
      throw new UnauthorizedError(authErrorMessage(error, "Authentication failed"));
    }

    return { success: true, message: "Logged out successfully" };
  }
);

service.action(
  "auth.me",
  {
    route: "/auth/me",
    method: "GET",
    auth: true,
    graphql: gqlQuery({
      fieldName: "authMe",
      description: "Retorna usuário autenticado atual",
      returnType: { type: GQL.JSON, required: true },
    }),
  },
  async (ctx) => {
    if (!ctx.auth) {
      throw new UnauthorizedError("Authentication client is not available");
    }

    if (!ctx.user) {
      throw new UnauthorizedError("Not authenticated");
    }

    const authHeader = ctx.headers?.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        return await ctx.auth.getUserInfo(token);
      } catch {
        // fall back to context user
      }
    }

    return {
      id: ctx.user.id,
      username:
        (ctx.user.metadata?.preferred_username as string | undefined) ??
        (ctx.user.metadata?.username as string | undefined) ??
        "",
      email: ctx.user.metadata?.email as string | undefined,
      roles: ctx.user.roles ?? [],
      groups: [],
      metadata: ctx.user.metadata,
    };
  }
);

service.action(
  "auth.discovery",
  {
    route: "/auth/discovery",
    method: "GET",
    graphql: gqlQuery({
      fieldName: "authDiscovery",
      description: "Retorna documento OIDC discovery",
      returnType: { type: GQL.JSON, required: true },
    }),
  },
  async (ctx) => {
    if (!ctx.auth) {
      throw new UnauthorizedError("Authentication client is not available");
    }
    return ctx.auth.getDiscovery();
  }
);

// =============================================================================
// GraphQL Queries (operações de leitura)
// =============================================================================

/**
 * Lista todos os livros
 *
 * GraphQL Query:
 *   query { books { id title author year isbn } }
 */
service.action(
  "books.list",
  {
    route: "/graphql-example/books",
    method: "GET",
    graphql: gqlQuery({
      fieldName: "books",
      description: "Lista todos os livros disponíveis",
      returnType: { type: "Book", list: true, required: true },
    }),
  },
  async () => {
    return Array.from(books.values());
  }
);

/**
 * Busca um livro por ID
 *
 * GraphQL Query:
 *   query { book(id: "1") { id title author } }
 */
service.action(
  "books.get",
  {
    route: "/graphql-example/books/:id",
    method: "GET",
    graphql: gqlQuery({
      fieldName: "book",
      description: "Busca um livro específico pelo ID",
      args: {
        id: { type: GQL.ID, required: true, description: "ID do livro" },
      },
      returnType: { type: "Book", required: false },
    }),
  },
  async (ctx) => {
    const book = books.get(ctx.params.id);
    if (!book) {
      return null;
    }
    return book;
  }
);

/**
 * Busca livros por autor
 *
 * GraphQL Query:
 *   query { booksByAuthor(author: "Robert") { id title } }
 */
service.action(
  "books.byAuthor",
  {
    route: "/graphql-example/books/author/:author",
    method: "GET",
    graphql: gqlQuery({
      fieldName: "booksByAuthor",
      description: "Busca livros por nome do autor",
      args: {
        author: {
          type: GQL.String,
          required: true,
          description: "Nome ou parte do nome do autor",
        },
      },
      returnType: { type: "Book", list: true, required: true },
    }),
  },
  async (ctx) => {
    const authorSearch = ctx.params.author.toLowerCase();
    return Array.from(books.values()).filter((book) =>
      book.author.toLowerCase().includes(authorSearch)
    );
  }
);

// =============================================================================
// GraphQL Mutations (operações de escrita)
// =============================================================================

/**
 * Cria um novo livro
 *
 * GraphQL Mutation:
 *   mutation {
 *     createBook(input: { title: "New Book", author: "Author", year: 2024 }) {
 *       id title
 *     }
 *   }
 */
service.action(
  "books.create",
  {
    route: "/graphql-example/books",
    method: "POST",
    validate: createBookSchema,
    roles: ["editor", "admin"],
    graphql: gqlMutation({
      fieldName: "createBook",
      description: "Cria um novo livro na biblioteca",
      args: {
        input: { type: "CreateBookInput", required: true },
      },
      returnType: { type: "Book", required: true },
    }),
  },
  async (ctx) => {
    const input = createBookSchema.parse(ctx.body);
    const id = crypto.randomUUID();
    const book: Book = {
      id,
      ...input,
      createdAt: new Date(),
    };
    books.set(id, book);

    service.logger.info("Book created", { bookId: id, title: book.title });
    const eventPayload: BookCreatedEvent = {
      bookId: id,
      title: book.title,
      author: book.author,
      year: book.year,
    };
    ctx.emit("book.created", eventPayload);

    return book;
  }
);

/**
 * Subscription metadata para stream de eventos de criação de livros.
 *
 * GraphQL Subscription:
 *   subscription {
 *     bookCreated {
 *       bookId
 *       title
 *       author
 *       year
 *     }
 *   }
 */
service.action(
  "books.stream.created",
  {
    route: "/graphql-example/books/events/created",
    method: "GET",
    graphql: gqlSubscription({
      fieldName: "bookCreated",
      description: "Stream de eventos quando um livro é criado",
      streamKind: "event",
      streamPattern: "book.created",
      returnType: { type: "BookCreatedEvent", required: true },
    }),
  },
  async () => {
    return {
      info: "Use GraphQL subscription field `bookCreated` over WebSocket.",
    };
  }
);

/**
 * Deleta um livro
 *
 * GraphQL Mutation:
 *   mutation { deleteBook(id: "1") }
 */
service.action(
  "books.delete",
  {
    route: "/graphql-example/books/:id",
    method: "DELETE",
    roles: ["admin"],
    graphql: gqlMutation({
      fieldName: "deleteBook",
      description: "Remove um livro da biblioteca",
      args: {
        id: { type: GQL.ID, required: true },
      },
      returnType: { type: GQL.Boolean, required: true },
    }),
  },
  async (ctx) => {
    if (!books.has(ctx.params.id)) {
      return false;
    }
    books.delete(ctx.params.id);
    service.logger.info("Book deleted", { bookId: ctx.params.id });
    return true;
  }
);

// =============================================================================
// Consumindo GraphQL APIs Externas
// =============================================================================

/**
 * Exemplo de endpoint que consome API GraphQL externa
 * Demonstra o uso do GraphQL Client do SDK
 */
service.action(
  "external.countries",
  {
    route: "/graphql-example/external/countries",
    method: "GET",
  },
  async () => {
    // Cria client para API pública de países
    const client = createGraphQLClient({
      endpoint: "https://countries.trevorblades.com/graphql",
    });

    try {
      interface CountryResponse {
        countries: Array<{
          code: string;
          name: string;
          emoji: string;
        }>;
      }

      // Busca primeiros 5 países
      const result = await client.query<CountryResponse>(`
        query {
          countries {
            code
            name
            emoji
          }
        }
      `);

      return {
        source: "countries.trevorblades.com",
        count: result.countries.length,
        sample: result.countries.slice(0, 5),
      };
    } catch (error) {
      service.logger.error("Failed to fetch countries", { error });
      return { error: "Failed to fetch external data" };
    }
  }
);

// =============================================================================
// Start Service
// =============================================================================

service.beforeStart(async () => {
  service.logger.info("GraphQL Example starting", {
    booksCount: books.size,
  });
});

setupGracefulShutdown(service.raw);

await service.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: env.string("LINKD_URL", "unix:/tmp/linkd.sock"),
    hint: "Inicie o Linkd e tente novamente.",
  }),
);
