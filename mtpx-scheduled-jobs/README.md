# Scheduled Jobs Example

Este exemplo demonstra como usar jobs agendados (cron/repeatable) com o Multpex Framework.

## Conceito

O sistema de scheduled jobs tem **duas partes separadas**:

```
┌───────────────────────────────────────────────────────────────────┐
│  API (index.ts)                                                   │
│  - Cria schedulers via queue.upsertJobScheduler()                 │
│  - Define QUANDO criar jobs na fila                               │
└───────────────────────────────────────────────────────────────────┘
                               │
                               ▼ (job criado no Redis)
┌───────────────────────────────────────────────────────────────────┐
│  Worker (worker.ts)                                               │
│  - Processa jobs da fila                                          │
│  - Define O QUE FAZER quando receber o job                        │
└───────────────────────────────────────────────────────────────────┘
```

## Estrutura

```
src/
├── index.ts        # API HTTP para gerenciar schedulers
├── worker.ts       # Worker que processa os jobs
└── schedules.yaml  # Jobs fixos carregados no startup (opcional)
postman/
├── mtpx-scheduled-jobs.postman_collection.json  # Collection do Postman
└── mtpx-scheduled-jobs.postman_environment.json # Variáveis de ambiente
```

## Executando

### 0. Subir infraestrutura Docker compartilhada

A infraestrutura está no projeto:

https://github.com/Multpex/mtpx-framework-dev-infra

```bash
git clone https://github.com/Multpex/mtpx-framework-dev-infra.git
cd /path/to/mtpx-framework-dev-infra
docker compose up -d redis
```

### 1. Instalar dependências

```bash
cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-scheduled-jobs
bun install
```

### 2. Iniciar o Linkd (em outro terminal)

```bash
cd /path/to/multpex-framework/linkd
cargo run -- --redis-url redis://localhost:6379
```

### 3. Iniciar a API

```bash
# Terminal 1 - API HTTP para gerenciar schedulers
bun run dev
```

A API estará disponível em `http://localhost:3000`.

### 3.1 Autenticação obrigatória

Os endpoints de jobs, schedulers, queues e DLQ exigem autenticação via Bearer token.

Obtenha token com a CLI:

```bash
multpex login
```

Depois use o token no header:

```bash
Authorization: Bearer <seu_access_token>
```

### 4. Iniciar o Worker (em outro terminal)

```bash
# Terminal 2 - Worker que processa os jobs
bun run worker
```

O worker vai se conectar ao Linkd e aguardar jobs para processar.

## Jobs Disponíveis

O worker processa os seguintes tipos de job (baseado no `jobName`):

| Job Name | Descrição | Payload |
|----------|-----------|---------|
| `ProcessData` | Processa dados genéricos | `{ message?, items? }` |
| `GenerateReport` | Gera relatórios | `{ type, recipients? }` |
| `SendNotification` | Envia notificações | `{ userId?, channel?, message? }` |
| `Cleanup` | Limpa dados antigos | `{ table?, olderThanDays? }` |

## Postman Collection

Importe a collection do Postman para testar facilmente:

```
postman/mtpx-scheduled-jobs.postman_collection.json
```

Preencha a variável `accessToken` no environment local:

```
postman/mtpx-scheduled-jobs.postman_environment.json
```

> Nota: o recurso de importação de schedules ainda não está implementado.

Na collection, execute primeiro o grupo `Auth (Keycloak)`:

- Request: `Get Access Token (Password Grant)`
- O token é salvo automaticamente na variável `accessToken`
- Depois execute os endpoints de `Jobs`, `Schedulers`, `Queues` e `DLQ`

## Testando via cURL

### Criar um scheduler (a cada 10 segundos para teste)

```bash
curl -X POST http://localhost:3000/schedulers \
  -H "Authorization: Bearer <seu_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "schedulerKey": "test-job",
    "every": 10000,
    "jobName": "ProcessData",
    "data": { "message": "Hello from scheduler!" }
  }'
```

### Criar um scheduler com cron (todo dia às 9h)

```bash
curl -X POST http://localhost:3000/schedulers \
  -H "Authorization: Bearer <seu_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "schedulerKey": "daily-report",
    "pattern": "0 9 * * *",
    "jobName": "GenerateReport",
    "data": { "type": "daily" }
  }'
```

### Listar schedulers

```bash
curl http://localhost:3000/schedulers \
  -H "Authorization: Bearer <seu_access_token>"
```

### Remover scheduler

```bash
curl -X DELETE http://localhost:3000/schedulers/test-job \
  -H "Authorization: Bearer <seu_access_token>"
```

### Scheduler semanal de limpeza (domingo às 3h)

Use `SUN` no dia da semana para compatibilidade com o parser de cron do Linkd:

```bash
curl -X POST http://localhost:3000/schedulers \
  -H "Authorization: Bearer <seu_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "schedulerKey": "weekly-cleanup",
    "pattern": "0 3 * * SUN",
    "jobName": "Cleanup",
    "data": { "table": "logs", "olderThanDays": 30 }
  }'
```

## O que acontece

1. Você cria um scheduler via API
2. O Linkd armazena no Redis com o próximo horário de execução
3. Quando chega a hora, o Linkd cria um job na fila
4. O worker pega o job e executa a lógica
5. Repete conforme o padrão (cron ou intervalo)

## Adicionando Novos Jobs

Para adicionar um novo tipo de job:

### 1. Criar a classe handler

```typescript
class MyNewJob extends JobHandler<{ field1: string; field2?: number }, JobResult> {
  async handle() {
    // Sua lógica aqui
    return {
      success: true,
      message: "Job executado",
      data: { /* resultados */ },
    };
  }
}
```

### 2. Registrar no worker

```typescript
service.job(MyNewJob);
```

### 3. Criar o scheduler via API

```bash
curl -X POST http://localhost:3000/schedulers \
  -H "Authorization: Bearer <seu_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "schedulerKey": "my-scheduler",
    "every": 60000,
    "jobName": "MyNewJob",
    "data": { "field1": "value" }
  }'
```
