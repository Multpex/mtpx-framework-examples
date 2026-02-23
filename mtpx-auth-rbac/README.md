# Auth RBAC Example

Demonstra como usar o sistema de autorização baseado em roles (RBAC) integrado com Keycloak.

## Roles Disponíveis

| Role | Permissões |
|------|------------|
| `admin` | Acesso total: criar, editar, deletar, configurações |
| `editor` | Criar e editar documentos |
| `viewer` | Somente leitura |

## Pré-requisitos

1. Infraestrutura compartilhada rodando (PostgreSQL, NATS, Redis, Keycloak):
```bash
git clone https://github.com/Multpex/mtpx-framework-dev-infra.git
cd /path/to/mtpx-framework-dev-infra
docker compose up -d pg nats redis keycloak
```

2. Linkd rodando (em outro terminal):
```bash
cd /path/to/multpex-framework/linkd
cargo run
```

3. Login no CLI:
```bash
# Usuários de teste:
# admin/admin, editor/editor, viewer/viewer
multpex login
```

## Executando

```bash
cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-auth-rbac
bun run dev
```

## Endpoints

### Públicos (sem auth)

```bash
# Health check
curl http://localhost:3000/auth-example/health
```

### Viewer+ (viewer, editor, admin)

```bash
# Listar documentos
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/auth-example/documents

# Obter documento
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/auth-example/documents/seed-1
```

### Editor+ (editor, admin)

```bash
# Criar documento
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Novo Doc","content":"Conteúdo..."}' \
  http://localhost:3000/auth-example/documents

# Atualizar documento
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Título Atualizado"}' \
  http://localhost:3000/auth-example/documents/seed-1
```

### Admin Only

```bash
# Deletar documento
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/auth-example/documents/seed-1

# Configurações do sistema
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/auth-example/admin/settings

# Estatísticas
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/auth-example/admin/stats
```

### Perfil do Usuário

```bash
# Obter perfil e permissões
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/auth-example/profile/me

# Exportar (retorno varia conforme role)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/auth-example/documents/export
```

## Padrões de Autorização

### 1. Via Options do Action

```typescript
service.action(
  "documents.create",
  {
    roles: ["editor", "admin"], // Aceita qualquer uma dessas roles
  },
  async (ctx) => { ... }
);
```

### 2. Via Wrappers

```typescript
import { adminOnly, authenticated } from "@multpex/sdk-typescript";

service.action("admin.settings", { ... }, adminOnly(handler));
service.action("profile.me", { ... }, authenticated(handler));
```

### 3. Via withAuthorization

```typescript
import { withAuthorization } from "@multpex/sdk-typescript";

service.action(
  "documents.update",
  { ... },
  withAuthorization({ roles: ["editor", "admin"] }, handler)
);
```

### 4. Via Verificação Manual

```typescript
import { requireAdmin, assertRole, getAuthInfo } from "@multpex/sdk-typescript";

service.action("admin.stats", { authRequired: true }, async (ctx) => {
  requireAdmin(ctx);  // Throws se não for admin
  
  const auth = getAuthInfo(ctx);
  assertRole(ctx, ["editor", "admin"]);
  // Lógica específica para editor/admin
});
```

## Testando com Diferentes Roles

```bash
# Login como admin
multpex login  # Use admin/admin
export ADMIN_TOKEN=$(multpex whoami --token)

# Login como viewer  
multpex login  # Use viewer/viewer
export VIEWER_TOKEN=$(multpex whoami --token)

# Teste 1: Admin deve conseguir deletar
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/auth-example/documents/seed-1
# => 200 OK

# Teste 2: Viewer não deve conseguir deletar
curl -X DELETE -H "Authorization: Bearer $VIEWER_TOKEN" \
  http://localhost:3000/auth-example/documents/seed-1
# => 403 Forbidden: Insufficient permissions
```
