# mtpx-elasticsearch

Exemplo de aplicação demonstrando operações com **Elasticsearch** via SDK do Multpex Framework. Toda comunicação com o Elasticsearch ocorre através do sidecar `linkd`, sem conexão direta da aplicação ao cluster.

---

## Funcionalidades demonstradas

| Operação | Descrição |
|----------|-----------|
| Criação de índice | Cria o índice `products` com mapeamentos explícitos |
| Indexar documento | `POST /es/products` — cria um produto no ES com ID gerado automaticamente |
| Buscar por ID | `GET /es/products/:id` — recupera documento pelo ID |
| Atualização parcial | `PUT /es/products/:id` — atualiza campos do documento |
| Remover documento | `DELETE /es/products/:id` |
| Busca full-text | `GET /es/products?q=laptop` — busca em `name`, `description` e `tags` |
| Filtros | `?category=electronics&minPrice=100&maxPrice=999` |
| Paginação | `?from=0&size=10` |
| Ordenação | `?sort=price&order=asc` |
| Bulk indexing | `POST /es/products/bulk` — indexação em lote |
| Contagem | `GET /es/products/count?category=electronics` |
| Remoção de índice | `DELETE /es/admin/index` |

---

## Pré-requisitos

1. **Infraestrutura local** (Elasticsearch, Postgres, Redis, NATS, Keycloak) via `mtpx-framework-dev-infra`:
   ```bash
   cd mtpx-framework-dev-infra
   docker compose -f docker-compose-min.yml up -d
   ```
   O Elasticsearch sobe na porta `9200` com segurança desabilitada (modo desenvolvimento).

2. **linkd** em execução (processo nativo ou Docker, conforme o compose usado).

3. Sessão CLI ativa:
   ```bash
   mtpx login
   ```

4. **Credencial do Elasticsearch** registrada no keystore do `linkd`.

   > **Importante:** o `linkd` acessa o ES de dentro da rede Docker, portanto o URL deve usar o hostname do serviço (`elasticsearch`), não `localhost`:

   ```bash
   # Registrar/atualizar a credencial (confirma sobrescrita com "y")
   echo "y" | mtpx keystore set elasticsearch default \
     --field url=http://elasticsearch:9200 \
     --field username=elastic \
     --field password=multpex
   ```

   Para verificar que foi salva corretamente:
   ```bash
   mtpx keystore get elasticsearch default --reveal
   # url deve ser http://elasticsearch:9200
   ```

---

## Instalação e execução

```bash
cd mtpx-elasticsearch
cp .env.example .env
bun install
bun run dev
```

---

## Configuração (`.env`)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `LINKD_CONNECT` | `tcp://localhost:9999` | Endereço do sidecar linkd |
| `AUTH_REALM` | `multpex` | Realm Keycloak para autenticação HTTP |
| `AUTH_CLIENT_ID` | `multpex-services` | Client ID OIDC |
| `ES_CREDENTIAL` | `default` | Nome da credencial no keystore do linkd |

---

## Rotas disponíveis

### Administração do índice

```http
POST   /es/admin/index/setup    # Cria o índice com mapeamentos
DELETE /es/admin/index          # Remove o índice
```

### CRUD de produtos

```http
POST   /es/products             # Indexa novo produto
GET    /es/products/:id         # Busca por ID
PUT    /es/products/:id         # Atualiza campos
DELETE /es/products/:id         # Remove produto
```

### Busca e operações em lote

```http
GET    /es/products             # Busca com filtros e paginação
POST   /es/products/bulk        # Indexação em lote
GET    /es/products/count       # Contagem de documentos
```

---

## Exemplos de uso

### 1. Criar o índice

```bash
curl -X POST http://localhost:3000/es/admin/index/setup
```

### 2. Indexar um produto

```bash
curl -X POST http://localhost:3000/es/products \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Notebook Gamer",
    "description": "Processador i9, 32GB RAM, RTX 4070",
    "category": "electronics",
    "price": 8999.90,
    "stock": 5,
    "tags": ["laptop", "gaming", "i9"]
  }'
```

### 3. Busca full-text com filtros

```bash
# Busca por texto, filtro de categoria e range de preço
curl "http://localhost:3000/es/products?q=notebook&category=electronics&minPrice=500&maxPrice=10000&size=5&sort=price&order=asc"
```

### 4. Bulk indexing

```bash
curl -X POST http://localhost:3000/es/products/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "products": [
      {"name": "Mouse Gamer", "category": "peripherals", "price": 299.90, "stock": 20},
      {"name": "Teclado Mecânico", "category": "peripherals", "price": 499.90, "stock": 15},
      {"name": "Monitor 4K", "category": "electronics", "price": 3299.00, "stock": 8}
    ]
  }'
```

### 5. Contar por categoria

```bash
curl "http://localhost:3000/es/products/count?category=electronics"
```

---

## Arquitetura

```
App (Bun)
  └─ ctx.es (SidecarElasticsearchClient)
        └─ linkd sidecar (Unix socket / TCP)
              └─ Elasticsearch cluster (HTTP)
```

O SDK expõe o cliente Elasticsearch através de `ctx.es` em qualquer action handler. O `linkd` gerencia as credenciais e a conexão real ao cluster, isolando a aplicação de detalhes de rede e autenticação.

### API fluente vs Query DSL

O exemplo usa a **API fluente** (`SearchBuilder`) para buscas:

```typescript
const results = await ctx.es
  .index<Product>("products")
  .search()
  .multiMatch(q, ["name^2", "description"])
  .filter("category", "electronics")
  .range("price", { gte: 100, lte: 1000 })
  .sort("price", "asc")
  .page(1, 20)
  .execute();
```

Para casos avançados, a **Query DSL bruta** também está disponível:

```typescript
const results = await ctx.es.search("products", {
  query: {
    bool: {
      must: [{ match: { name: "laptop" } }],
      filter: [{ term: { category: "electronics" } }],
    },
  },
  aggs: { categories: { terms: { field: "category" } } },
});
```
