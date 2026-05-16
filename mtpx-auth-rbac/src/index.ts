/**
 * Auth RBAC Example
 *
 * Demonstra como usar autorização baseada em permissions com o SDK.
 *
 * Permissions usadas:
 *   - admin:global: Acesso total a todas as operações
 *   - write:db:*: Pode criar e editar recursos
 *   - read:db:*: Somente leitura
 *
 * Para testar:
 *   1. Inicie a infraestrutura: docker-compose up -d
 *   2. Execute o serviço: bun run dev
 *   3. Faça login no CLI: multpex login (admin/admin)
 *   4. Use o token para chamar as APIs
 */

import {
  createService,
  z,
  StartupErrorHandler,
  env,
  requireAuth,
} from "@linkd/sdk-typescript";

// =============================================================================
// Schema Definitions
// =============================================================================

const createDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string(),
  tags: z.array(z.string()).optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const documentParamsSchema = z.object({
  id: z.string().uuid("ID do documento deve ser um UUID válido"),
});

type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

interface Document {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// In-Memory Storage (para exemplo)
// =============================================================================

const documents = new Map<string, Document>();

// =============================================================================
// Service Setup
// =============================================================================

const service = createService({
  name: "auth-rbac-example",
  logging: {
    level: "debug",
    pretty: true,
  },
});

// =============================================================================
// Public Actions (sem autenticação)
// =============================================================================

service.action(
  "health",
  { route: "/auth-example/health", method: "GET" },
  async () => ({
    status: "healthy",
    timestamp: new Date().toISOString(),
    documentCount: documents.size,
  }),
);

// =============================================================================
// Viewer Actions (read:db:*)
// =============================================================================

service.action(
  "documents.list",
  {
    route: "/auth-example/documents",
    method: "GET",
    authorize: "read:db:*",
  },
  async (ctx) => ({
    documents: Array.from(documents.values()),
    meta: {
      total: documents.size,
      requestedBy: ctx.user?.id,
    },
  }),
);

service.action(
  "documents.get",
  {
    route: "/auth-example/documents/:id",
    method: "GET",
    authorize: "read:db:*",
    validateParams: documentParamsSchema,
  },
  async (ctx) => {
    const doc = documents.get(ctx.params.id);
    if (!doc) return { error: "Document not found", statusCode: 404 };
    return doc;
  },
);

// =============================================================================
// Editor Actions (write:db:*)
// =============================================================================

service.action(
  "documents.create",
  {
    route: "/auth-example/documents",
    method: "POST",
    authorize: "write:db:*",
    validate: createDocumentSchema,
  },
  async (ctx) => {
    const body = ctx.body as CreateDocumentInput;
    const id = crypto.randomUUID();

    const doc: Document = {
      id,
      title: body.title,
      content: body.content,
      tags: body.tags ?? [],
      createdBy: ctx.user!.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    documents.set(id, doc);
    ctx.emit("document.created", { documentId: id, title: doc.title });
    return doc;
  },
);

service.action(
  "documents.update",
  {
    route: "/auth-example/documents/:id",
    method: "PUT",
    authorize: "write:db:*",
    validate: updateDocumentSchema,
    validateParams: documentParamsSchema,
  },
  async (ctx) => {
    const doc = documents.get(ctx.params.id);
    if (!doc) return { error: "Document not found", statusCode: 404 };

    const body = ctx.body as UpdateDocumentInput;
    if (body.title !== undefined) doc.title = body.title;
    if (body.content !== undefined) doc.content = body.content;
    if (body.tags !== undefined) doc.tags = body.tags;
    doc.updatedAt = new Date();

    ctx.emit("document.updated", { documentId: doc.id });
    return doc;
  },
);

// =============================================================================
// Admin Actions (admin:global)
// =============================================================================

service.action(
  "documents.delete",
  {
    route: "/auth-example/documents/:id",
    method: "DELETE",
    authorize: "admin:global",
    validateParams: documentParamsSchema,
  },
  async (ctx) => {
    const doc = documents.get(ctx.params.id);
    if (!doc) return { error: "Document not found", statusCode: 404 };

    documents.delete(ctx.params.id);
    ctx.emit("document.deleted", { documentId: ctx.params.id });
    return { success: true, deletedId: ctx.params.id };
  },
);

service.action(
  "admin.settings",
  {
    route: "/auth-example/admin/settings",
    method: "GET",
    authorize: "admin:global",
  },
  async (ctx) => ({
    maxDocuments: 1000,
    retentionDays: 90,
    features: { versioning: true, audit: true },
    requestedBy: ctx.user?.id,
  }),
);

service.action(
  "admin.stats",
  {
    route: "/auth-example/admin/stats",
    method: "GET",
    authorize: "admin:global",
  },
  async () => {
    const docs = Array.from(documents.values());
    return {
      totalDocuments: docs.length,
      documentsPerUser: docs.reduce(
        (acc, doc) => {
          acc[doc.createdBy] = (acc[doc.createdBy] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      oldestDocument: docs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0],
      newestDocument: docs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0],
    };
  },
);

// =============================================================================
// Profile Action (qualquer usuário autenticado)
// =============================================================================

service.action(
  "profile.me",
  {
    route: "/auth-example/profile/me",
    method: "GET",
    authRequired: true,
  },
  async (ctx) => ({
    id: ctx.user!.id,
    tenantId: ctx.user!.tenantId,
    roles: ctx.user!.roles,
    permissions: {
      canView: (ctx.user as any).can("read:db:*"),
      canEdit: (ctx.user as any).can("write:db:*"),
      canAdmin: (ctx.user as any).can("admin:global"),
    },
    myDocuments: Array.from(documents.values()).filter(
      (doc) => doc.createdBy === ctx.user!.id,
    ),
  }),
);

service.action(
  "documents.export",
  {
    route: "/auth-example/documents/export",
    method: "GET",
    authRequired: true,
  },
  async (ctx) => {
    requireAuth(ctx);
    const allDocs = Array.from(documents.values());

    if ((ctx.user as any).can("admin:global")) {
      return {
        format: "full",
        documents: allDocs,
        includesPrivateData: true,
      };
    }

    if ((ctx.user as any).can("write:db:*")) {
      return {
        format: "standard",
        documents: allDocs.map(({ createdBy, ...doc }) => doc),
        includesPrivateData: false,
      };
    }

    return {
      format: "summary",
      documents: allDocs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        tags: doc.tags,
      })),
      includesPrivateData: false,
    };
  },
);

// =============================================================================
// Start Service
// =============================================================================

service.beforeStart(async () => {
  const seedDoc: Document = {
    id: "seed-1",
    title: "Welcome Document",
    content: "This is a sample document for testing RBAC.",
    tags: ["example", "welcome"],
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  documents.set(seedDoc.id, seedDoc);

  service.logger.info("Auth RBAC Example started", {
    seedDocuments: documents.size,
  });
});

await service.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: env.string("LINKD_URL", "unix:/tmp/linkd.sock"),
    hint: "Inicie o Linkd e tente novamente.",
  }),
);

