/**
 * Auth RBAC Example
 *
 * Demonstra como usar o sistema de autorização baseado em roles (RBAC)
 * integrado com Keycloak.
 *
 * Roles suportadas:
 *   - admin: Acesso total a todas as operações
 *   - editor: Pode criar e editar recursos
 *   - viewer: Somente leitura
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
  // Authorization helpers
  requireAuth,
  requireAdmin,
  getAuthInfo,
  withAuthorization,
  adminOnly,
  authenticated,
} from "@multpex/typescript-sdk";

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

/**
 * Endpoint público - não requer autenticação
 */
service.action(
  "health",
  { route: "/auth-example/health", method: "GET" },
  async () => {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      documentCount: documents.size,
    };
  }
);

// =============================================================================
// Viewer Actions (qualquer usuário autenticado pode acessar)
// =============================================================================

/**
 * Listar documentos - requer role viewer ou superior
 *
 * Usando o parâmetro `roles` no action options:
 */
service.action(
  "documents.list",
  {
    route: "/auth-example/documents",
    method: "GET",
    roles: ["viewer", "editor", "admin"], // Qualquer uma dessas roles
  },
  async (ctx) => {
    const auth = getAuthInfo(ctx);

    ctx.logger.info("Listing documents", {
      userId: auth.userId ?? undefined,
      roles: auth.roles ?? undefined,
    });

    return {
      documents: Array.from(documents.values()),
      meta: {
        total: documents.size,
        requestedBy: auth.userId,
      },
    };
  }
);

/**
 * Obter documento por ID - usando withAuthorization()
 */
service.action(
  "documents.get",
  { route: "/auth-example/documents/:id", method: "GET" },
  withAuthorization({ roles: ["viewer", "editor", "admin"] }, async (ctx) => {
    const doc = documents.get(ctx.params.id);
    if (!doc) {
      return { error: "Document not found", statusCode: 404 };
    }
    return doc;
  })
);

// =============================================================================
// Editor Actions (requer role editor ou admin)
// =============================================================================

/**
 * Criar documento - usando roles no options
 */
service.action(
  "documents.create",
  {
    route: "/auth-example/documents",
    method: "POST",
    roles: ["editor", "admin"],
    validate: createDocumentSchema,
  },
  async (ctx) => {
    const auth = getAuthInfo(ctx);
    const body = ctx.body as CreateDocumentInput;
    const id = crypto.randomUUID();

    const doc: Document = {
      id,
      title: body.title,
      content: body.content,
      tags: body.tags ?? [],
      createdBy: auth.userId!,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    documents.set(id, doc);

    service.logger.info("Document created", {
      documentId: id,
      createdBy: auth.userId,
    });

    ctx.emit("document.created", { documentId: id, title: doc.title });

    return doc;
  }
);

/**
 * Atualizar documento - usando withAuthorization()
 */
service.action(
  "documents.update",
  {
    route: "/auth-example/documents/:id",
    method: "PUT",
    validate: updateDocumentSchema,
  },
  withAuthorization({ roles: ["editor", "admin"] }, async (ctx) => {
    const doc = documents.get(ctx.params.id);
    if (!doc) {
      return { error: "Document not found", statusCode: 404 };
    }

    const auth = getAuthInfo(ctx);
    const body = ctx.body as UpdateDocumentInput;

    // Atualizar campos fornecidos
    if (body.title !== undefined) doc.title = body.title;
    if (body.content !== undefined) doc.content = body.content;
    if (body.tags !== undefined) doc.tags = body.tags;
    doc.updatedAt = new Date();

    service.logger.info("Document updated", {
      documentId: ctx.params.id,
      updatedBy: auth.userId,
    });

    ctx.emit("document.updated", { documentId: doc.id });

    return doc;
  })
);

// =============================================================================
// Admin Actions (somente admin)
// =============================================================================

/**
 * Deletar documento - usando roles: ["admin"]
 */
service.action(
  "documents.delete",
  {
    route: "/auth-example/documents/:id",
    method: "DELETE",
    roles: ["admin"],
  },
  async (ctx) => {
    const doc = documents.get(ctx.params.id);
    if (!doc) {
      return { error: "Document not found", statusCode: 404 };
    }

    documents.delete(ctx.params.id);

    const auth = getAuthInfo(ctx);
    service.logger.info("Document deleted", {
      documentId: ctx.params.id,
      deletedBy: auth.userId,
    });

    ctx.emit("document.deleted", { documentId: ctx.params.id });

    return { success: true, deletedId: ctx.params.id };
  }
);

/**
 * Configurações do sistema - usando wrapper adminOnly()
 */
service.action(
  "admin.settings",
  { route: "/auth-example/admin/settings", method: "GET" },
  adminOnly(async (ctx) => {
    return {
      maxDocuments: 1000,
      retentionDays: 90,
      features: {
        versioning: true,
        audit: true,
      },
      requestedBy: ctx.user?.id,
    };
  })
);

/**
 * Estatísticas administrativas - verificação manual de role
 */
service.action(
  "admin.stats",
  {
    route: "/auth-example/admin/stats",
    method: "GET",
    authRequired: true, // Requer autenticação
  },
  async (ctx) => {
    // Verificação manual usando requireAdmin
    requireAdmin(ctx);

    const docs = Array.from(documents.values());

    return {
      totalDocuments: docs.length,
      documentsPerUser: docs.reduce(
        (acc, doc) => {
          acc[doc.createdBy] = (acc[doc.createdBy] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
      oldestDocument: docs.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      )[0],
      newestDocument: docs.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      )[0],
    };
  }
);

// =============================================================================
// Profile Action (qualquer usuário autenticado)
// =============================================================================

/**
 * Obter perfil do usuário atual - usando wrapper authenticated()
 */
service.action(
  "profile.me",
  { route: "/auth-example/profile/me", method: "GET" },
  authenticated(async (ctx) => {
    const auth = getAuthInfo(ctx);

    return {
      id: auth.userId,
      tenantId: auth.tenantId,
      roles: auth.roles,
      permissions: {
        canView: auth.isViewer,
        canEdit: auth.isEditor,
        canAdmin: auth.isAdmin,
      },
      // Documentos criados pelo usuário
      myDocuments: Array.from(documents.values()).filter(
        (doc) => doc.createdBy === auth.userId
      ),
    };
  })
);

/**
 * Action com lógica condicional baseada em role
 */
service.action(
  "documents.export",
  {
    route: "/auth-example/documents/export",
    method: "GET",
    authRequired: true,
  },
  async (ctx) => {
    // Verificação manual para lógica condicional
    requireAuth(ctx);

    const auth = getAuthInfo(ctx);
    const allDocs = Array.from(documents.values());

    // Admin: exporta tudo com metadados completos
    if (auth.isAdmin) {
      return {
        format: "full",
        documents: allDocs,
        includesPrivateData: true,
      };
    }

    // Editor: exporta tudo, mas sem metadados sensíveis
    if (auth.isEditor) {
      return {
        format: "standard",
        documents: allDocs.map(({ createdBy, ...doc }) => doc),
        includesPrivateData: false,
      };
    }

    // Viewer: exporta apenas títulos
    return {
      format: "summary",
      documents: allDocs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        tags: doc.tags,
      })),
      includesPrivateData: false,
    };
  }
);

// =============================================================================
// Start Service
// =============================================================================

service.beforeStart(async () => {
  // Seed com alguns documentos de exemplo
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

await service.start();
