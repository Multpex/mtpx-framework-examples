# mtpx-minimal-app

Exemplo mínimo do `@multpex/sdk-typescript` com rotas básicas, autenticação em mutations e testes de integração.

## Pré-requisitos

- Bun
- `linkd` em execução

## Executar em desenvolvimento

```bash
bun install
bun run dev
```

## Modos de conexão com linkd

- TCP: `LINKD_CONNECT=tcp://localhost:9999` com a sessão atual do `mtpx login` (recomendado para host -> Docker)
- Unix socket: `LINKD_CONNECT=unix:///tmp/linkd.sock` (quando o linkd roda local no host)

Se o linkd estiver em Docker no macOS, prefira TCP.

## Executar em modo normal

```bash
bun run start
```

## Build

```bash
bun run build
bun run start:prod
```

## Testes

```bash
bun run test
```

Teste de integração específico:

```bash
bun run test:integration
```

## Testes Postman

```bash
bun run postman:test
```

## O que o exemplo demonstra

- Setup básico de serviço com SDK
- Endpoints HTTP com validação
- Integração com contexto (`ctx`) do framework
- Fluxo de testes automatizados (Bun + Postman)
