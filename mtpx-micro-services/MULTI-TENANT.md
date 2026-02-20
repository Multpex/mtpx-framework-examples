# Multi-Tenant Authentication Setup

Este documento descreve como configurar e testar autenticação multi-tenant com Keycloak.

## Arquitetura

O sistema suporta multi-tenancy automático. O SDK resolve o realm automaticamente via:

1. **Body**: Campo `realm` no corpo da requisição
2. **Header**: Header `X-Realm`  
3. **Hostname**: Subdomínio (ex: `realm1.localhost:3000`)
4. **Default**: Configuração do serviço

```
realm1.localhost:3000 → Realm "realm1"
realm2.localhost:3000 → Realm "realm2"
localhost:3000        → Realm padrão (multpex)
```

## Uso no Código

O realm já vem resolvido no contexto:

```typescript
service.action("login", async (ctx) => {
  // ctx.realm - O realm resolvido automaticamente
  // ctx.realmSource - Como foi determinado: "body" | "header" | "hostname" | "default"
  
  console.log(`Realm: ${ctx.realm}, Source: ${ctx.realmSource}`);
  
  // Auth client já está configurado com o realm correto
  const result = await ctx.auth.login({ username, password });
});
```

## Configuração do Serviço

```typescript
const service = createService<Schema>({
  name: "auth",
  auth: {
    enabled: true,
    realm: "multpex",           // Realm padrão
    clientId: "multpex-services",
    knownRealms: ["realm1", "realm2"], // Realms aceitos via hostname
  },
});
```

## Configuração do /etc/hosts

Adicione as seguintes entradas ao seu `/etc/hosts`:

```bash
# Multi-tenant Keycloak realms
127.0.0.1 realm1.localhost
127.0.0.1 realm2.localhost
```

Para editar:
```bash
sudo nano /etc/hosts
```

## Realms Disponíveis

### master (Administração)
- URL: http://localhost:8180/admin/
- Usuário: admin
- Senha: admin

### realm1 (Tenant A)
| Usuário | Senha | Roles |
|---------|-------|-------|
| user1 | password1 | user |
| admin1 | adminpass1 | admin, user |

- Client ID: `multpex-services`
- Client Secret: `multpex-services-secret`

### realm2 (Tenant B)
| Usuário | Senha | Roles |
|---------|-------|-------|
| user2 | password2 | user |
| admin2 | adminpass2 | admin, user |

- Client ID: `multpex-services`
- Client Secret: `multpex-services-secret`

## Testando Multi-Tenancy

### 1. Via Subdomínio (Recomendado)

```bash
# Login no realm1 via hostname
curl -X POST http://realm1.localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "user1", "password": "password1"}'

# Login no realm2 via hostname
curl -X POST http://realm2.localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "user2", "password": "password2"}'
```

### 2. Via Body (Fallback)

```bash
# Login especificando realm no body
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "user1", "password": "password1", "realm": "realm1"}'
```

### 3. Discovery por Tenant

```bash
# Discovery do realm1
curl http://realm1.localhost:3000/auth/discovery

# Discovery do realm2
curl http://realm2.localhost:3000/auth/discovery
```

## Prioridade de Resolução do Realm

1. **Body**: Se `realm` for especificado no corpo da requisição
2. **Hostname**: Extrai do subdomínio (ex: `realm1.localhost`)
3. **Default**: Usa `AUTH_REALM` env var ou "multpex"

## Configuração do Keycloak

Os arquivos de configuração estão em `config/keycloak/`:

```
config/keycloak/
├── realm1.json          # Tenant A
├── realm2.json          # Tenant B
├── multpex-realm.json   # Realm principal
└── multpex-test-realm.json  # Testes
```

## Protocol Mappers

Cada realm inclui mappers para:

1. **client-roles**: Mapeia roles do client para o token
2. **tenant-mapper**: Inclui atributo `tenant` no token

## Verificando Tokens

Os tokens de cada realm incluem:
- `iss`: Issuer com o realm (ex: `http://keycloak:8080/realms/realm1`)
- `roles`: Roles do usuário
- `tenant`: Identificador do tenant

## Troubleshooting

### Realm não reconhecido
Verifique se o subdomínio está na lista `KNOWN_REALMS` em `auth.service.ts`.

### Erro de conexão
Verifique se as entradas no `/etc/hosts` estão corretas.

### Token inválido entre realms
Tokens são específicos por realm. Um token de `realm1` não é válido em `realm2`.
