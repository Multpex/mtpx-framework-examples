# Exemplo de Microserviços (estilo Moleculer)

Um exemplo completo de microserviços usando o Multpex Framework com arquitetura inspirada no Moleculer.

## Visão Geral

Este exemplo demonstra:

- **Service Loader**: descoberta automática e carregamento de serviços de um diretório
- **Fluent Query Builder**: queries de banco com tipagem para PostgreSQL
- **Arquitetura orientada a eventos**: comunicação entre serviços via eventos NATS
- **Channels (JetStream)**: mensageria com balanceamento e controle ack/nack
- **Cache de resposta HTTP**: cache em Redis com TTL configurável
- **Autenticação OIDC**: integração com Keycloak para validação de JWT
- **Health Checks**: endpoints `/health`, `/ready`, `/live` prontos para Kubernetes

### Serviços

| Serviço         | Descrição                           | Endpoints                                      |
| --------------- | ------------------------------------ | ---------------------------------------------- |
| `auth`          | Autenticação e gestão de tokens      | `/auth/login`, `/auth/me`, `/auth/refresh`     |
| `users`         | Gestão de contas de usuários         | `/users`, `/users/:id`, `/users/stats`         |
| `products`      | Catálogo de produtos e estoque       | `/products`, `/products/:id`, `/products/categories` |
| `orders`        | Processamento e status de pedidos    | `/orders`, `/orders/:id`, `/orders/stats`      |
| `notifications` | Demo de channels (email, SMS)        | `/notifications/email`, `/notifications/sms`             |

## Pré-requisitos

- [Bun](https://bun.sh/) v1.0+
- [Docker](https://www.docker.com/) & Docker Compose
- [Rust](https://www.rust-lang.org/) (apenas para desenvolvimento local do Linkd)
- Repositório de infraestrutura Docker compartilhada: https://github.com/Multpex/mtpx-framework-dev-infra

## Início Rápido

### Opção 1: Desenvolvimento Local (Recomendado)

Suba a infraestrutura no Docker e rode Linkd + app localmente para desenvolvimento mais rápido com hot-reload:

```bash
# 1. Subir infraestrutura (PostgreSQL, NATS, Redis, Keycloak)
git clone https://github.com/Multpex/mtpx-framework-dev-infra.git
cd /path/to/mtpx-framework-dev-infra
docker compose up -d pg nats redis keycloak

# 2. Compilar e executar o Linkd (em outro terminal)
cd /path/to/multpex-framework/linkd
cargo build
./target/debug/linkd

# 3. Instalar dependências e rodar a aplicação (em outro terminal)
cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-micro-services
bun install
bun dev
```

Acesse a API em `http://localhost:3000`

### Opção 2: Infraestrutura via Docker Compose

Execute a infraestrutura em foreground/background a partir de `mtpx-framework-dev-infra`:

```bash
# Dentro de mtpx-framework-dev-infra
cd /path/to/mtpx-framework-dev-infra

# Subir infraestrutura (PostgreSQL, NATS, Redis, Keycloak)
docker compose up

# Ou rodar em background
docker compose up -d

# Ver logs
docker compose logs -f
```

Acesse a API em `http://localhost:3000` (com Linkd + app rodando localmente)

### Opção 3: Rodar Serviços Individualmente

Para um deployment estilo microserviços, rode cada serviço separadamente:

```bash
# Terminal 1: Subir infraestrutura + linkd
cd /path/to/mtpx-framework-dev-infra && docker compose up -d pg nats redis keycloak
cd /path/to/multpex-framework/linkd && cargo run

# Terminal 2: Serviço de usuários
SERVICE=users bun run src/main.ts

# Terminal 3: Serviço de pedidos
SERVICE=orders bun run src/main.ts

# Terminal 4: Serviço de produtos
SERVICE=products bun run src/main.ts
```

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        HTTP Gateway                             │
│                    (Linkd @ port 3000/8080)                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                    Unix Socket │ /tmp/linkd.sock
                                │
┌─────────────────────────────────────────────────────────────────┐
│                        Linkd                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Database  │  │    Cache    │  │    Auth     │              │
│  │   Gateway   │  │   (Redis)   │  │   (OIDC)    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    NATS     │  │   Events    │  │   Queues    │              │
│  │   Client    │  │    Bus      │  │   Queues    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
        │                   │                   │                   │
        ▼                   ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  PostgreSQL   │   │     NATS      │   │     Redis     │   │   Keycloak    │
│   (Database)  │   │   (Events)    │   │    (Cache)    │   │    (Auth)     │
└───────────────┘   └───────────────┘   └───────────────┘   └───────────────┘
```

### Responsabilidades dos Componentes

| Componente     | Finalidade                                                   |
| -------------- | ------------------------------------------------------------ |
| **Linkd**      | Proxy do Linkd para DB, cache, auth, eventos e rotas HTTP   |
| **PostgreSQL** | Armazenamento principal de dados para todos os serviços      |
| **NATS**       | Broker para eventos (broadcast) e channels (JetStream)      |
| **Redis**      | Cache distribuído e backend de filas                         |
| **Keycloak**   | Provedor de identidade para autenticação OIDC/OAuth2         |

### Eventos vs Channels

Este exemplo demonstra os dois padrões de mensageria:

| Aspecto          | Eventos (Broadcast)                   | Channels (JetStream)                   |
| ---------------- | ------------------------------------- | -------------------------------------- |
| **Entrega**      | Todos os subscribers recebem          | Um subscriber por grupo                |
| **Caso de uso**  | Notificações, logging, sincronização  | Processamento de jobs, distribuição    |
| **Durabilidade** | Fire-and-forget                       | Durável com ack/nack                   |
| **Backpressure** | Não                                   | Sim (maxInFlight)                      |
| **Retry**        | Não                                   | Configurável com DLQ                   |
| **Example**      | `ctx.emit("order.created", data)`     | `ctx.channels.send("email", data)`     |

### Credenciais de Teste

O realm do Keycloak vem pré-configurado com usuários de teste:

| Usuário  | Senha       | Role  | Descrição          |
| -------- | ----------- | ----- | ------------------ |
| `admin`  | `admin`     | admin | Acesso total       |
| `testuser` | `multpex` | user  | Usuário comum      |

**Keycloak Admin Console**: http://localhost:8180 (admin/admin)

## Configuração

### Variáveis de Ambiente

| Variável           | Padrão                   | Descrição                     |
| ------------------ | ------------------------ | ----------------------------- |
| `LINKD_CONNECT`    | `unix:///tmp/linkd.sock` | String de conexão do Linkd    |
| `LINKD_NAMESPACE`  | `microservice-demo`      | Namespace de serviços         |
| `AUTH_PROVIDER`    | `oidc/default`           | Provider OIDC no keystore (`oidc/<nome>` ou `<nome>`) |
| `AUTH_REALM`       | `multpex`                | Realm OIDC padrão            |
| `AUTH_CLIENT_ID`   | `multpex-services`       | Client ID OIDC padrão        |
| `SERVICE`          | (all)                    | Serviço(s) específicos para subir |
| `SKIP_MIGRATIONS`  | `false`                  | Pula migrações no startup (útil para teste rápido de auth) |
| `DEBUG`            | `false`                  | Habilita logs de debug        |
| `NODE_ENV`         | `development`            | Modo de ambiente              |

### Setup rápido de OIDC via `.env`

```bash
cp .env.example .env
```

Garanta também que o provider exista no keystore do linkd:

```bash
mtpx oidc set default \
  --provider oidc \
  --issuer-url http://localhost:8180 \
  --realm multpex \
  --client-id multpex-services \
  --client-secret multpex
```

### Configuração do Linkd

O Linkd é configurado via `../../linkd/linkd.toml`. Principais ajustes:

```toml
socket_path = "/tmp/linkd.sock"
http_addr = "0.0.0.0:3000"
nats_url = "nats://localhost:4222"

[database]
url = "postgres://multpex:multpex_secret@localhost:5432/multpex"

[cache]
type = "redis"
redis_url = "redis://localhost:6379"
```

## Referência da API

### Autenticação

```bash
# Login (retorna access_token e refresh_token)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'

# Obter informações do usuário atual
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer <access_token>"

# Renovar token
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "<refresh_token>"}'

# Logout
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer <access_token>"
```

### Users

```bash
# Listar usuários
curl http://localhost:3000/users \
  -H "Authorization: Bearer $TOKEN"

# Obter usuário por ID
curl http://localhost:3000/users/123 \
  -H "Authorization: Bearer $TOKEN"

# Criar usuário
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Lucas Silva",
    "email": "lucas@example.com",
    "role": "user"
  }'

# Atualizar usuário
curl -X PUT http://localhost:3000/users/123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Lucas Silva Updated",
    "status": "active"
  }'

# Deletar usuário
curl -X DELETE http://localhost:3000/users/123 \
  -H "Authorization: Bearer $TOKEN"

# Estatísticas de usuários
curl http://localhost:3000/users/stats \
  -H "Authorization: Bearer $TOKEN"
```

### Products

```bash
# Listar produtos
curl http://localhost:3000/products \
  -H "Authorization: Bearer $TOKEN"

# Obter produto por ID
curl http://localhost:3000/products/456 \
  -H "Authorization: Bearer $TOKEN"

# Criar produto
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sku": "LAPTOP-002",
    "name": "MacBook Pro 14",
    "price": 22999.99,
    "stock": 50,
    "category": "electronics"
  }'

# Atualizar produto
curl -X PUT http://localhost:3000/products/456 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "price": 21999.99,
    "stock": 45
  }'

# Ajustar estoque
curl -X POST http://localhost:3000/products/456/stock \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "adjustment": -5,
    "reason": "sold"
  }'

# Listar categorias
curl http://localhost:3000/products/categories \
  -H "Authorization: Bearer $TOKEN"
```

### Orders

```bash
# Listar pedidos
curl http://localhost:3000/orders \
  -H "Authorization: Bearer $TOKEN"

# Obter pedido por ID
curl http://localhost:3000/orders/789 \
  -H "Authorization: Bearer $TOKEN"

# Criar pedido
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "userId": "123",
    "items": [
      {"productId": "456", "quantity": 2, "price": 21999.99}
    ],
    "shippingAddress": {
      "street": "Av. Paulista, 1000",
      "city": "São Paulo",
      "state": "SP",
      "zipCode": "01310-100"
    }
  }'

# Atualizar status do pedido
curl -X PATCH http://localhost:3000/orders/789/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"status": "shipped"}'

# Cancelar pedido
curl -X POST http://localhost:3000/orders/789/cancel \
  -H "Authorization: Bearer $TOKEN"

# Estatísticas de pedidos
curl http://localhost:3000/orders/stats \
  -H "Authorization: Bearer $TOKEN"
```

### Notificações (Demo de Channels)

```bash
# Enviar email via Channel (balanceado para UM worker)
curl -X POST http://localhost:3000/notifications/email \
  -H "Content-Type: application/json" \
  -d '{
    "to": "user@example.com",
    "subject": "Welcome!",
    "body": "Thanks for signing up.",
    "priority": "high"
  }'

# Enviar SMS via Channel
curl -X POST http://localhost:3000/notifications/sms \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+5511999998888",
    "message": "Your order has shipped!"
  }'
```

### Verificações de Saúde

```bash
# Health de serviço (todos expõem estes endpoints)
curl http://localhost:3000/users/health
curl http://localhost:3000/orders/health
curl http://localhost:3000/products/health
curl http://localhost:3000/auth/health

# Probes do Kubernetes
curl http://localhost:3000/users/ready   # Readiness
curl http://localhost:3000/users/live    # Liveness
```

## Comunicação Orientada a Eventos

Os serviços se comunicam via eventos NATS:

| Evento                | Publicador | Subscribers       | Descrição                |
| --------------------- | ---------- | ----------------- | ------------------------ |
| `user.created`        | users      | orders            | Novo usuário registrado  |
| `user.deleted`        | users      | orders            | Conta de usuário removida |
| `order.created`       | orders     | products, users   | Novo pedido criado       |
| `order.completed`     | orders     | products, users   | Pedido concluído         |
| `payment.completed`   | (external) | orders            | Pagamento recebido       |
| `stock.reserve`       | orders     | products          | Reserva de estoque       |
| `stock.release`       | orders     | products          | Liberação de estoque reservado |
| `product.unavailable` | products   | orders            | Produto sem estoque      |

## Channels (JetStream)

O serviço `notifications` demonstra Channels para processamento com balanceamento:

| Channel                | Group            | maxInFlight | Descrição                      |
| ---------------------- | ---------------- | ----------- | ------------------------------ |
| `notifications.email`  | email-workers    | 3           | Entrega de email (SMTP)        |
| `notifications.sms`    | sms-workers      | 10          | Entrega de SMS                 |

### Recursos de Channels

```typescript
// Inscrever em um channel com opções
service.channel<EmailPayload>("notifications.email", {
  group: "email-workers",    // Grupo consumidor (balanceado)
  maxInFlight: 3,            // Backpressure: máximo de mensagens concorrentes
}, async (ctx) => {
  try {
    await sendEmail(ctx.body);
    await ctx.message.ack();                   // ✅ Confirma sucesso
  } catch (error) {
    await ctx.message.nack({ requeue: true }); // ❌ Reprocessa
  }
});

// Enviar para channel (de action ou handler de evento)
ctx.sendToChannel("notifications.email", {
  to: "user@example.com",
  subject: "Hello",
  body: "Welcome!",
});
```
```

## Schema do Banco

O exemplo usa PostgreSQL com as seguintes tabelas:

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(20) DEFAULT 'user',
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock INTEGER DEFAULT 0,
  category VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  total DECIMAL(10,2) NOT NULL,
  items JSONB NOT NULL,
  shipping_address JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

As migrations são aplicadas automaticamente no startup via sistema de migration do SDK.

## Solução de Problemas

### Erro de Conexão no Socket (ENOENT)

```
error: Failed to connect
  errno: -2,
  code: "ENOENT"
```

**Causa**: O Linkd não está rodando.

**Solução**: Inicie o Linkd antes de executar a aplicação:

```bash
# Linkd não faz parte da infraestrutura Docker compartilhada.
# Inicie localmente:
cd /path/to/multpex-framework/linkd
cargo run
```

### Erro de Conexão com o Banco

**Causa**: PostgreSQL não está rodando ou não está acessível.

**Solução**:

```bash
# Start PostgreSQL
cd /path/to/mtpx-framework-dev-infra
docker compose up -d pg

# Verify it's running
docker compose ps pg
docker compose logs pg
```

### Erro de Conexão com NATS

**Causa**: NATS não está rodando (eventos não funcionarão).

**Solução**:

```bash
cd /path/to/mtpx-framework-dev-infra
docker compose up -d nats
```

### Erro de Conexão com Redis

**Causa**: Redis não está rodando (cache não funcionará, mas a aplicação ainda funciona).

**Solução**:

```bash
cd /path/to/mtpx-framework-dev-infra
docker compose up -d redis
```

## Dicas de Desenvolvimento

### Hot Reload

O comando `bun dev` habilita hot reload para desenvolvimento mais rápido:

```bash
bun dev
```

### Modo Debug

Habilite logs verbosos:

```bash
DEBUG=true bun dev
```

### Rodando Serviços Específicos

```bash
# Serviço único
SERVICE=users bun run src/main.ts

# Múltiplos serviços
SERVICE=users,orders bun run src/main.ts
```

### Collection do Postman

Importe a collection do Postman em `./postman/` para testar a API com facilidade.

## Estrutura do Projeto

```
moleculer-style/
├── src/
│   ├── main.ts              # Ponto de entrada da aplicação
│   ├── config.ts            # Carregador de configuração
│   ├── db/
│   │   ├── schema.ts        # Tipos do schema do banco
│   │   └── migrations.ts    # Migrations do banco
│   └── services/
│       ├── auth.service.ts     # Serviço de autenticação
│       ├── users.service.ts    # Serviço CRUD de usuários
│       ├── products.service.ts # Serviço de catálogo de produtos
│       └── orders.service.ts   # Serviço de gestão de pedidos
├── postman/                 # Collection do Postman para testar API
├── docker-compose.yml       # Setup Docker da stack completa
├── Dockerfile               # Container da aplicação
├── mtpx.config.ts        # Configuração da CLI do Multpex
└── package.json
```

## Licença

MIT
