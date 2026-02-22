# mtpx-keycloak-admin-basics

Exemplo de operações básicas de administração do Keycloak via SDK:

- listar roles
- criar role
- listar usuários
- criar usuário
- atribuir role a usuário

## Pré-requisitos

- Linkd em execução
- Keycloak disponível
- Provider OIDC cadastrado no keystore

Exemplo de provider local:

```bash
mtpx oidc set default \
  --provider oidc \
  --issuer-url http://localhost:8180 \
  --realm multpex \
  --client-id multpex-services \
  --client-secret multpex
```

## Configuração

```bash
cp .env.example .env
```

Principais variáveis:

- `AUTH_PROVIDER`: provider usado para autenticar requisições HTTP da API
- `OIDC_ADMIN_PROVIDER`: provider usado para chamadas Admin API no Keycloak
- `OIDC_ADMIN_REALM`: realm alvo das operações de usuário/role

## Executar

```bash
bun install
bun run dev
```

Base URL: `http://localhost:3000`

## Endpoints

### Health

```bash
curl http://localhost:3000/keycloak-admin/health
```

### Listar roles (admin)

```bash
curl "http://localhost:3000/keycloak-admin/roles?search=admin&max=20" \
  -H "Authorization: Bearer $TOKEN"
```

### Criar role (admin)

```bash
curl -X POST http://localhost:3000/keycloak-admin/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "support",
    "description": "Support role"
  }'
```

### Listar usuários (admin)

```bash
curl "http://localhost:3000/keycloak-admin/users?search=admin&max=20" \
  -H "Authorization: Bearer $TOKEN"
```

### Criar usuário (admin)

```bash
curl -X POST http://localhost:3000/keycloak-admin/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "demo.user",
    "email": "demo.user@multpex.local",
    "firstName": "Demo",
    "lastName": "User",
    "password": "Demo@123",
    "roles": ["support"]
  }'
```

### Atribuir role a usuário (admin)

```bash
curl -X POST http://localhost:3000/keycloak-admin/users/<USER_ID>/roles/support \
  -H "Authorization: Bearer $TOKEN"
```

## Observações

- Os endpoints são protegidos por `roles: ["admin"]`.
- O app usa credenciais `oidc/<provider>` do keystore para autenticar no Admin API.
- O `issuer_url` do provider é normalizado automaticamente para `baseUrl` do cliente Keycloak.
