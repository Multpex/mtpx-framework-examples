# mtpx-db-env-selector

Exemplo de app que seleciona o database do linkd por variável de ambiente e executa um fluxo simples de escrita/leitura com o Fluent Query Builder.

## Pré-requisitos

- Bun
- `linkd` em execução (socket padrão `unix:///tmp/linkd.sock`)

## Configuração

Crie/ajuste o arquivo `.env`:

```env
LINKD_DATABASE_NAME=docker-pg-test
# LINKD_CONNECT=unix:///tmp/linkd.sock
```

## Executar

```bash
bun install
bun run dev
```

Ou em modo normal:

```bash
bun run start
```

## Verificação de tipos

```bash
bun run typecheck
```

## O que o exemplo demonstra

- Autoload de `.env` no SDK
- Uso de `ctx.env` para acessar variáveis de ambiente
- Criação de tabela com `database.schema.createTableIfNotExists`
- Escrita com `table.upsert(...)`
- Leitura e remoção de registro
