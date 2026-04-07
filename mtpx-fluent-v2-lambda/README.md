# mtpx-fluent-v2-lambda

Exemplo local focado no **Fluent V2** com `where((...) => ...)` em estilo lambda.

## O que este exemplo cobre

- `where((u) => u.active && u.age >= 18 && u.age < 65)`
- `where((u) => ["user-1", "user-4"].includes(u.id))`
- `join(..., lambda)` com `where((o, u) => ...)`
- `whereEquals(...)`, `whereGt(...)` e `whereIn(...)` como alternativa para predicados dinâmicos com valores de runtime

## Subset suportado na lambda

- acesso estático a campos a partir dos parâmetros do callback
- literais inline
- arrays literais apenas na forma `arrayLiteral.includes(field)`
- `&&`, `||`, `!`
- comparações (`===`, `!==`, `>`, `>=`, `<`, `<=`)
- `includes`, `startsWith`, `endsWith` em valores de campo

## O que não entra na lambda

- valores capturados do escopo externo
- `this`
- `new Date()` e chamadas arbitrárias de runtime
- object literals
- arrays literais fora da forma `arrayLiteral.includes(field)`

Quando o predicado depende de `ctx.query`, `ctx.body` ou qualquer valor dinâmico, use a API explícita do builder, como `whereEquals(...)`, `whereGt(...)` e `whereIn(...)`.

## Setup

```bash
cp .env.example .env
bun install
bun dev
```

## Endpoints

```text
GET /fluent-v2
GET /fluent-v2/users/eligible
GET /fluent-v2/users/picked
GET /fluent-v2/orders/high-value
GET /fluent-v2/jobs/dynamic?tenantId=acme&minPriority=10
```

## Observações

- O exemplo cria as tabelas `users`, `orders` e `jobs` automaticamente no `afterConnect`.
- O seed é idempotente via `upsert`.
- O pacote depende do `sdk-typescript` local deste workspace via `file:../../sdk-typescript`.

## setup database

```bash
lnk-gmstg db server add local-pg --dialect postgresql --host localhost --runtime-host postgres --port 5432 --admin-user multpex --admin-password multpex
```
✓ DB server 'local-pg' salvo no keystore (namespace: default).
ℹ Nenhuma database foi criada. O server add registra apenas o perfil de conexão.

```bash
lnk-gmstg db database create local-pg-test-fluent-v2-lambda --server local-pg
```
✓ Database 'local-pg-test-fluent-v2-lambda' criada com sucesso.
✓ Credencial 'local-pg:local-pg-test-fluent-v2-lambda' salva no keystore (namespace: default).