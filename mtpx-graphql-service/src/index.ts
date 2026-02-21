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
  z,
  handleCommonStartupError,
  env,
  // GraphQL helpers para definir metadata
  gqlQuery,
  gqlMutation,
  GQL,
  gqlType,
  gqlInput,
  // GraphQL Client para consumir APIs
  createGraphQLClient,
  type Context,
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

interface Book {
  id: string;
  title: string;
  author: string;
  year: number;
  isbn?: string;
  createdAt: Date;
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
    ],
  },
});

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
    ctx.emit("book.created", { bookId: id });

    return book;
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

try {
  await service.start();
} catch (error) {
  handleCommonStartupError(error, {
    dependencyName: "Linkd",
    endpoint: env.string("LINKD_URL", "unix:/tmp/linkd.sock"),
    hint: "Inicie o Linkd e tente novamente.",
  });
}
