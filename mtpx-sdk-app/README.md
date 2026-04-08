# mtpx-sdk-app

App de exemplo usando o `@linkd/sdk-typescript` com suporte a banco de dados via linkd.

---

## Pré-requisitos

- [Bun](https://bun.sh) instalado
- `mtpx` CLI instalado e no PATH (`~/.linkd/cli-runtime/launcher`)
- Docker com a infraestrutura do `mtpx-framework-dev-infra` rodando

```bash
# Iniciar a infra local (Postgres, Redis, NATS, Keycloak, linkd)
cd /path/to/mtpx-framework-dev-infra
docker compose up -d
```

---

## Instalação

```bash
bun install
```

---

## Executar em desenvolvimento

```bash
bun run dev
```

O servidor sobe na porta `3000` com hot-reload via `bun --hot`.

---

## Configuração do banco de dados

O arquivo `linkd.config.ts` define como o app se conecta ao linkd e ao banco:

```ts
export default {
  name: "mtpx-sdk-app",
  database: {
    schemaFile: "./src/db/schema.ts",
    output: "./src/db/schema.ts",
    migrationsPath: "./migrations",
    syncAfterMigrate: true, // regenera os tipos após cada migrate
    include: ["*"],
    exclude: ["_migrations"],
  },
  linkd: {
    connect: "tcp://localhost:9999",
    database: "mtpx_sdk_app",
  },
};
```

### 1. Registrar o servidor de banco de dados

Só é necessário fazer uma vez por clone/ambiente:

```bash
mtpx db server add docker-pg \
  --dialect postgresql \
  --host localhost \
  --runtime-host postgres \
  --port 5432 \
  --admin-user postgres \
  --admin-password postgres
```

- `--host` é o host acessível pela CLI (da máquina host)
- `--runtime-host` é o hostname usado pelo linkd dentro da rede Docker

### 2. Criar o banco de dados da aplicação

```bash
mtpx db database create mtpx_sdk_app --server docker-pg
```

Isso cria o banco e o usuário `mtpx_sdk_app` no Postgres, e salva a credencial no keystore local.

> **Aguarde ~5 segundos** após este comando antes de rodar migrations — o linkd atualiza o pool de conexões a cada 5 segundos ao detectar novas credenciais no keystore.

### 3. Criar uma migration

```bash
mtpx db:migrate create create_users_table
```

Um arquivo TypeScript é gerado em `./migrations/` com o timestamp no nome, ex: `20260408154844_create_users_table.ts`.

Edite o arquivo gerado para definir o schema:

```ts
import type { MigrationBuilder } from "@linkd/sdk-typescript";

export async function up(schema: MigrationBuilder): Promise<void> {
  await schema.createTable("users", (table) => {
    table.uuid("id").primary();
    table.string("name", 255).notNullable();
    table.string("email", 255).notNullable().unique();
    table.timestamp("created_at").nullable().default("CURRENT_TIMESTAMP");
    table.timestamp("updated_at").nullable().default("CURRENT_TIMESTAMP");
  });
}

export async function down(schema: MigrationBuilder): Promise<void> {
  await schema.dropTable("users");
}
```

> Use `.notNullable()`, não `.notNull()`.

### 4. Executar as migrations

```bash
mtpx db:migrate up
```

Como `syncAfterMigrate: true` está configurado, o arquivo `src/db/schema.ts` é regenerado automaticamente após cada migration bem-sucedida.

### 5. Regenerar os tipos manualmente (opcional)

Se precisar regenerar os tipos sem rodar migrations:

```bash
mtpx db:generate
```

O arquivo gerado em `src/db/schema.ts` reflete o schema atual do banco.

---

## Usando o banco no código

Importe o tipo gerado com `import type` para evitar erros de `verbatimModuleSyntax`:

```ts
import { createService } from "@linkd/sdk-typescript";
import type { Schema } from "./db/schema.js";

const service = createService<Schema>({ name: "users" });

service.get("/users", async (ctx) => {
  return await ctx.db.users
    .whereEquals("active", true)
    .orderByField("name", "asc")
    .limit(10)
    .get();
});
```

---

## Comandos úteis

| Comando | Descrição |
|---------|-----------|
| `mtpx db server add <name> ...` | Registra um servidor de banco de dados |
| `mtpx db server list` | Lista os servidores registrados |
| `mtpx db database create <name> --server <server>` | Cria banco e credencial no keystore |
| `mtpx db:migrate create <name>` | Cria um novo arquivo de migration |
| `mtpx db:migrate up` | Executa as migrations pendentes |
| `mtpx db:migrate down` | Reverte o último batch de migrations (pode ser N migrations) |
| `mtpx db:migrate down --step 1` | Reverte exatamente 1 migration |
| `mtpx db:migrate status` | Exibe o status das migrations |
| `mtpx db:generate` | Regenera `src/db/schema.ts` a partir do banco |
| `bun run dev` | Inicia o servidor em modo desenvolvimento |

