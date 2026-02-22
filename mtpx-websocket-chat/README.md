# Exemplo de Chat WebSocket

> ⚠️ **IMPORTANTE**: Este exemplo demonstra a **API WebSocket do SDK TypeScript**, mas o suporte WebSocket no **Linkd ainda não está implementado**. 
>
> **Status Atual**:
> - ✅ SDK TypeScript: API WebSocket completa e funcional
> - ❌ Linkd: Gateway WebSocket pendente de implementação
> - ✅ HTTP endpoints: Totalmente funcionais
> - ❌ Conexões WebSocket: Retornarão **404 Not Found** até implementação do gateway
>
> Veja `TESTING.md` para detalhes e `docs/WEBSOCKET-API-PROPOSAL.md` para a proposta completa.

Este exemplo demonstra o uso da API WebSocket do Multpex Framework, seguindo o mesmo padrão ergonômico das actions HTTP.

## Início Rápido

### Setup Automático (Recomendado)

```bash
# 1. Subir infraestrutura compartilhada
git clone https://github.com/Multpex/mtpx-framework-dev-infra.git
cd /path/to/mtpx-framework-dev-infra
docker compose up -d nats pg redis

# 2. Em um terminal, iniciar o Linkd
cd /path/to/multpex-framework/linkd
cargo run

# 3. Em outro terminal, iniciar o serviço WebSocket Chat
cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-websocket-chat
bun dev

# 4. Testar HTTP endpoints (FUNCIONAM)
curl http://localhost:3000/chat/health
curl http://localhost:3000/chat/rooms/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa

# 5. Tentar WebSocket (RETORNA 404 - Gateway não implementado)
# websocat ws://localhost:3000/ws/chat
# Erro: 404 Not Found (aguardando implementação do gateway WebSocket no Linkd)
```

> **Nota**: Conexões WebSocket falharão com 404 até que o gateway WebSocket seja implementado no Linkd. Os endpoints HTTP funcionam normalmente.

### Documentação Completa

Para instruções detalhadas de teste, solução de problemas e exemplos de cliente, veja:
- **[TESTING.md](./TESTING.md)** - Guia completo de testes passo a passo

## Estrutura

```
websocket-chat/
├── src/
│   ├── main.ts              # Ponto de entrada
│   ├── db/
│   │   └── schema.ts        # Tipos do schema do banco
│   └── services/
│       └── chat.service.ts  # Serviço de chat com handlers WebSocket
├── package.json
├── tsconfig.json
└── README.md
```

## Pré-requisitos

- Docker e Docker Compose (infraestrutura compartilhada em `https://github.com/Multpex/mtpx-framework-dev-infra`)
- Bun 1.3+ (para executar o serviço)
- Rust 1.88+ (para compilar o Linkd)
- Infraestrutura rodando (NATS, PostgreSQL, Redis)
- Linkd rodando e conectado

## Executando Manualmente

```bash
# 1. Iniciar infraestrutura
git clone https://github.com/Multpex/mtpx-framework-dev-infra.git
cd /path/to/mtpx-framework-dev-infra
docker compose up -d nats pg redis

# 2. Voltar para o exemplo
cd /path/to/multpex-framework/mtpx-framework-examples/mtpx-websocket-chat

# 3. Criar schema do banco (veja TESTING.md)

# 4. Instalar dependências
bun install

# 5. Executar
bun run dev
```

### Graceful Shutdown (automático)

Este exemplo sobe serviços com `startServices(...)` em `src/main.ts`.
O `ServiceLoader` já registra graceful shutdown automaticamente via `setupGracefulShutdown`.

- Sinais suportados: `SIGINT` e `SIGTERM`
- `Ctrl+C` encerra os serviços carregados de forma ordenada
- Não é necessário adicionar handlers de sinal manualmente

## API WebSocket (Proposta - Aguardando Implementação no Linkd)

> ⚠️ A API abaixo está implementada no SDK TypeScript, mas **não funcionará** até que o gateway WebSocket seja implementado no Linkd.

### Conectar

```javascript
const ws = new WebSocket("ws://localhost:3000/ws/chat");
// Atualmente retorna: 404 Not Found
```

### Eventos Recebidos

| Evento | Payload | Descrição |
|--------|---------|-----------|
| `chat.message` | `{ id, roomId, userId, content, createdAt }` | Nova mensagem no chat |
| `user.joined` | `{ userId, roomId }` | Usuário entrou na sala |
| `user.left` | `{ userId, roomId }` | Usuário saiu da sala |
| `user.typing` | `{ userId, roomId, isTyping }` | Indicador de digitação |
| `user.online` | `{ userId }` | Usuário ficou online |
| `user.offline` | `{ userId }` | Usuário ficou offline |

### Mensagens Enviadas

#### Entrar em uma sala

```json
{
  "type": "chat.join",
  "data": { "room": "uuid-da-sala" },
  "id": "msg-123"
}
```

#### Enviar mensagem

```json
{
  "type": "chat.send",
  "data": { 
    "room": "uuid-da-sala", 
    "message": "Olá!" 
  },
  "id": "msg-124"
}
```

#### Indicador de digitação

```json
{
  "type": "chat.typing",
  "data": { 
    "room": "uuid-da-sala", 
    "isTyping": true 
  }
}
```

#### Buscar histórico

```json
{
  "type": "chat.history",
  "data": { 
    "room": "uuid-da-sala", 
    "limit": 50 
  },
  "id": "msg-125"
}
```

## Comparação com Actions HTTP

A API de WebSocket segue o mesmo padrão das actions HTTP:

| Actions HTTP | WebSocket |
|-------------|-----------|
| `service.action("name", opts, fn)` | `service.ws.on("name", opts, fn)` |
| `ctx.body` | `ctx.message` |
| `ctx.db.users.whereEquals()` | `ctx.db.users.whereEquals()` |
| `ctx.auth` | `ctx.auth` |
| `service.group("prefix", cb)` | `service.ws.group("prefix", cb)` |
| `service.use(middleware)` | `service.ws.use(middleware)` |
| `return data` | `return data` (ack) |

## Exemplo de Cliente (JavaScript) - Aguardando Implementação

> ⚠️ Este código está pronto para uso, mas **falhará na conexão (404)** até que o gateway WebSocket seja implementado no Linkd.

```javascript
class ChatClient {
  constructor(url, token) {
    this.ws = new WebSocket(`${url}?token=${token}`);
    this.pending = new Map();
    this.handlers = new Map();
    
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onopen = () => console.log("Conectado");
    this.ws.onclose = () => console.log("Desconectado");
  }
  
  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event).add(handler);
  }
  
  async send(type, data) {
    const id = crypto.randomUUID();
    
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type, data, id }));
      
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("Tempo limite excedido"));
        }
      }, 30000);
    });
  }
  
  handleMessage(event) {
    const { type, data, id, error } = JSON.parse(event.data);
    
    if (id && this.pending.has(id)) {
      const { resolve, reject } = this.pending.get(id);
      this.pending.delete(id);
      error ? reject(new Error(error.message)) : resolve(data);
      return;
    }
    
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.forEach(h => h(data));
    }
  }
}

// Uso (atualmente retornará erro 404)
const chat = new ChatClient("ws://localhost:3000/ws/chat", accessToken);

chat.on("chat.message", (msg) => {
  console.log(`${msg.userId}: ${msg.content}`);
});

chat.on("user.typing", ({ userId, isTyping }) => {
  console.log(`${userId} ${isTyping ? "está digitando..." : "parou de digitar"}`);
});

// Entrar na sala e enviar mensagem
await chat.send("chat.join", { room: "room-uuid" });
await chat.send("chat.send", { room: "room-uuid", message: "Olá!" });
```

## O Que Funciona Atualmente

✅ **HTTP Endpoints**:
- `GET /chat/health` - Verificação de saúde do serviço
- `GET /chat/ready` - Verificação de prontidão do serviço
- `GET /chat/live` - Verificação de liveness do serviço
- `GET /chat/rooms/:id` - Obter detalhes de uma sala
- `POST /chat/rooms` - Criar uma nova sala

❌ **WebSocket Endpoints**:
- `ws://localhost:3000/ws/chat` - **404 Not Found** (gateway não implementado)

## Roadmap WebSocket

Para que o WebSocket funcione, é necessário implementar no Linkd:

1. **Handler de Upgrade HTTP para WebSocket**
   - Detectar header `Upgrade: websocket`
   - Fazer handshake WebSocket (RFC 6455)

2. **Gerenciador de Conexões**
   - Gerenciar conexões WebSocket ativas
   - Associar conexões a usuários autenticados
   - Implementar rooms/grupos

3. **Roteador de Mensagens**
   - Rotear mensagens WebSocket para serviços via Unix socket
   - Protocolo de comunicação Linkd ↔ SDK
   - Broadcasting para múltiplos clientes

4. **Recursos WebSocket**
   - Ping/pong heartbeat
  - Tratamento de reconexão
   - Message compression (permessage-deflate)
  - Limitação de taxa (rate limiting)

Veja `docs/WEBSOCKET-API-PROPOSAL.md` para detalhes completos da proposta.
```
