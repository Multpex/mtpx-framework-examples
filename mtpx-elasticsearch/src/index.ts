/**
 * mtpx-elasticsearch — Exemplo de operações com Elasticsearch via SDK
 *
 * Demonstra:
 *   - Indexação e CRUD de documentos
 *   - Busca full-text com a API fluente (SearchBuilder)
 *   - Busca com Query DSL bruto
 *   - Filtros, ranges, ordenação e paginação
 *   - Operações bulk
 *   - Contagem de documentos
 *   - Operações de índice (criar, verificar existência, deletar)
 *
 * Pré-requisitos:
 *   1. linkd rodando com credencial Elasticsearch no keystore:
 *        mtpx es credential add default --url http://localhost:9200
 *   2. Elasticsearch acessível pelo linkd (porta 9200 por padrão)
 *
 * Rotas:
 *   POST   /es/products              Indexa um produto
 *   GET    /es/products/:id          Busca produto por ID
 *   PUT    /es/products/:id          Atualiza produto parcialmente
 *   DELETE /es/products/:id          Remove produto
 *   GET    /es/products              Lista/busca produtos (query params: q, category, minPrice, maxPrice, from, size)
 *   POST   /es/products/bulk         Indexação em lote
 *   GET    /es/products/count        Conta produtos (query params: category)
 *   POST   /es/admin/index/setup     Cria o índice com mapeamentos
 *   DELETE /es/admin/index           Remove o índice
 */

import {
  createApp,
  requestLogger,
  StartupErrorHandler,
  env,
  z,
} from "@multpex/sdk-typescript";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface Product {
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  tags: string[];
  active: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Schemas de validação
// ---------------------------------------------------------------------------

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  category: z.string().min(1).max(100),
  price: z.number().positive(),
  stock: z.number().int().min(0).default(0),
  tags: z.array(z.string()).optional().default([]),
  active: z.boolean().optional().default(true),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().min(1).max(100).optional(),
  price: z.number().positive().optional(),
  stock: z.number().int().min(0).optional(),
  tags: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

const bulkProductSchema = z.object({
  products: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().min(1).max(200),
      description: z.string().max(2000).optional().default(""),
      category: z.string().min(1).max(100),
      price: z.number().positive(),
      stock: z.number().int().min(0).default(0),
      tags: z.array(z.string()).optional().default([]),
      active: z.boolean().optional().default(true),
    }),
  ),
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const INDEX = "products";

const app = createApp({
  name: "mtpx-elasticsearch",
  namespace: "es-example",
  auth: {
    realm: env.string("AUTH_REALM", "multpex"),
    clientId: env.string("AUTH_CLIENT_ID", "multpex-services"),
  },
});

app.use(requestLogger());

app.afterStart(async () => {
  app.logger.info("mtpx-elasticsearch pronto. Acesse as rotas /es/*");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function parseIntQuery(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? ""), 10);
  return isNaN(n) ? fallback : n;
}

function parseFloatQuery(value: unknown): number | undefined {
  const n = parseFloat(String(value ?? ""));
  return isNaN(n) ? undefined : n;
}

// ---------------------------------------------------------------------------
// Criação do índice com mapeamentos
// ---------------------------------------------------------------------------

app.action(
  "setup-index",
  { route: "/es/admin/index/setup", method: "POST" },
  async (ctx) => {
    const es = app.es;
    const index = es.index<Product>(INDEX);

    const exists = await index.indexExists();
    if (exists) {
      return { message: `Índice '${INDEX}' já existe.`, created: false };
    }

    await index.createIndex({
      settings: { number_of_shards: 1, number_of_replicas: 0, "translog.durability": "async" },
      mappings: {
        properties: {
          name: { type: "text", analyzer: "standard" },
          description: { type: "text", analyzer: "standard" },
          category: { type: "keyword" },
          price: { type: "double" },
          stock: { type: "integer" },
          tags: { type: "keyword" },
          active: { type: "boolean" },
          createdAt: { type: "date" },
        },
      },
    });

    return { message: `Índice '${INDEX}' criado com sucesso.`, created: true };
  },
);

// ---------------------------------------------------------------------------
// Remoção do índice
// ---------------------------------------------------------------------------

app.action(
  "delete-index",
  { route: "/es/admin/index", method: "DELETE" },
  async (ctx) => {
    const es = app.es;
    const index = es.index<Product>(INDEX);

    const exists = await index.indexExists();
    if (!exists) {
      return { error: `Índice '${INDEX}' não encontrado.`, statusCode: 404 };
    }

    await index.deleteIndex();
    return { message: `Índice '${INDEX}' removido.` };
  },
);

// ---------------------------------------------------------------------------
// Indexar produto
// ---------------------------------------------------------------------------

app.action(
  "create-product",
  { route: "/es/products", method: "POST" },
  async (ctx) => {
    const parsed = createProductSchema.safeParse(ctx.body);
    if (!parsed.success) {
      return { error: "Dados inválidos", details: parsed.error.issues, statusCode: 400 };
    }

    const doc: Product = {
      ...parsed.data,
      createdAt: nowIso(),
    };

    const result = await app.es.index<Product>(INDEX).create(doc, { refresh: true });

    return {
      id: result.id,
      result: result.result,
      product: doc,
    };
  },
);

// ---------------------------------------------------------------------------
// Buscar produto por ID
// ---------------------------------------------------------------------------

app.action(
  "get-product",
  { route: "/es/products/:id", method: "GET" },
  async (ctx) => {
    const { id } = ctx.params;
    const response = await app.es.index<Product>(INDEX).get(id);

    if (!response.found) {
      return { error: "Produto não encontrado.", statusCode: 404 };
    }

    return { id: response.id, product: response.source };
  },
);

// ---------------------------------------------------------------------------
// Atualização parcial de produto
// ---------------------------------------------------------------------------

app.action(
  "update-product",
  { route: "/es/products/:id", method: "PUT" },
  async (ctx) => {
    const { id } = ctx.params;

    const parsed = updateProductSchema.safeParse(ctx.body);
    if (!parsed.success) {
      return { error: "Dados inválidos", details: parsed.error.issues, statusCode: 400 };
    }

    if (Object.keys(parsed.data).length === 0) {
      return { error: "Nenhum campo para atualizar.", statusCode: 400 };
    }

    const result = await app.es.index<Product>(INDEX).update(id, parsed.data, {
      refresh: true,
    });

    return { id: result.id, result: result.result };
  },
);

// ---------------------------------------------------------------------------
// Remover produto
// ---------------------------------------------------------------------------

app.action(
  "delete-product",
  { route: "/es/products/:id", method: "DELETE" },
  async (ctx) => {
    const { id } = ctx.params;

    const result = await app.es.index<Product>(INDEX).delete(id, { refresh: true });

    if (result.result === "not_found") {
      return { error: "Produto não encontrado.", statusCode: 404 };
    }

    return { id: result.id, result: result.result };
  },
);

// ---------------------------------------------------------------------------
// Busca e listagem de produtos
//
// Query params:
//   q          — busca full-text em name + description
//   category   — filtro exato por categoria
//   minPrice   — preço mínimo (range)
//   maxPrice   — preço máximo (range)
//   active     — "true"/"false" (filtro boolean)
//   from       — offset para paginação (default: 0)
//   size       — tamanho da página (default: 10, max: 100)
//   sort       — campo de ordenação (default: _score)
//   order      — "asc" | "desc" (default: desc)
// ---------------------------------------------------------------------------

app.action(
  "search-products",
  { route: "/es/products", method: "GET" },
  async (ctx) => {
    const q = ctx.query?.q as string | undefined;
    const category = ctx.query?.category as string | undefined;
    const minPrice = parseFloatQuery(ctx.query?.minPrice);
    const maxPrice = parseFloatQuery(ctx.query?.maxPrice);
    const activeParam = ctx.query?.active as string | undefined;
    const from = parseIntQuery(ctx.query?.from, 0);
    const size = Math.min(parseIntQuery(ctx.query?.size, 10), 100);
    const sortField = (ctx.query?.sort as string | undefined) ?? "_score";
    const order = (ctx.query?.order as "asc" | "desc" | undefined) ?? "desc";

    const builder = app.es
      .index<Product>(INDEX)
      .search()
      .from(from)
      .size(size)
      .trackTotalHits(true);

    // Busca full-text em múltiplos campos
    if (q) {
      builder.multiMatch(["name^2", "description", "tags"], q, {
        type: "best_fields",
        fuzziness: "AUTO",
      });
    }

    // Filtros exatos
    if (category) {
      builder.filter("category", category);
    }

    if (activeParam !== undefined) {
      builder.filter("active", activeParam === "true");
    }

    // Filtro de range de preço
    if (minPrice !== undefined || maxPrice !== undefined) {
      const range: { gte?: number; lte?: number } = {};
      if (minPrice !== undefined) range.gte = minPrice;
      if (maxPrice !== undefined) range.lte = maxPrice;
      builder.range("price", range);
    }

    // Ordenação
    if (sortField !== "_score") {
      builder.sort(sortField as keyof Product & string, order);
    }

    const results = await builder.execute();

    return {
      total: results.total,
      from,
      size,
      hits: results.hits.map((h) => ({ id: h.id, score: h.score, ...h.source })),
    };
  },
);

// ---------------------------------------------------------------------------
// Indexação em lote (bulk)
// ---------------------------------------------------------------------------

app.action(
  "bulk-products",
  { route: "/es/products/bulk", method: "POST" },
  async (ctx) => {
    const parsed = bulkProductSchema.safeParse(ctx.body);
    if (!parsed.success) {
      return { error: "Dados inválidos", details: parsed.error.issues, statusCode: 400 };
    }

    const operations = parsed.data.products.map((p) => ({
      action: "index" as const,
      id: p.id,
      document: { ...p, createdAt: nowIso() } as Record<string, unknown>,
    }));

    const result = await app.es.index<Product>(INDEX).bulk(operations, { refresh: true });

    const succeeded = result.items.filter((i) => i.status < 300).length;
    const failed = result.items.filter((i) => i.status >= 300);

    return {
      took: result.took,
      errors: result.errors,
      succeeded,
      failed: failed.length,
      failedItems: failed.length > 0 ? failed : undefined,
    };
  },
);

// ---------------------------------------------------------------------------
// Contagem de documentos
// ---------------------------------------------------------------------------

app.action(
  "count-products",
  { route: "/es/products/count", method: "GET" },
  async (ctx) => {
    const category = ctx.query?.category as string | undefined;

    let count: number;

    if (category) {
      count = await app.es.count(INDEX, { term: { category } });
    } else {
      count = await app.es.count(INDEX);
    }

    return { count, index: INDEX, ...(category ? { category } : {}) };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

await app.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: env.string("LINKD_CONNECT", "tcp://localhost:9999"),
    hint: [
      "Certifique-se de que o linkd está em execução e que a credencial Elasticsearch está registrada:",
      "  mtpx es credential add default --url http://localhost:9200",
    ].join("\n"),
  }),
);
