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
`LINKD_DATABASE_NAME` usa o formato composto `<provider>-<db-server-type>-<database-name>`.

## Provisionamento (obrigatório no modo registro full via keystore)

Antes de executar o exemplo, registre o server e o database no keystore:

```bash
mtpx db server add docker-pg --dialect postgresql --host localhost --port 5432 --admin-user multpex --admin-password multpex
mtpx db database create docker-pg-test --server docker-pg
```

Depois disso, aguarde o watcher de DB do linkd sincronizar (padrão: até 5s).  
Se quiser reduzir esse tempo no ambiente, ajuste `LINKD_DB_WATCHER_INTERVAL_SECS`.

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
- Uso de `mtpx.env` para acessar variáveis de ambiente
- Criação de tabela com `database.schema.createTableIfNotExists`
- Escrita com `table.upsert(...)`
- Leitura e remoção de registro
