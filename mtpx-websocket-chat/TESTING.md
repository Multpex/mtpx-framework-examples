# Guia de Testes - WebSocket Chat Example

> ⚠️ **AVISO IMPORTANTE**: Este exemplo demonstra a API WebSocket do SDK TypeScript, mas o **suporte WebSocket no Linkd ainda não está implementado**. O exemplo compila e executa, mas conexões WebSocket retornarão **404 Not Found** até que o gateway WebSocket seja implementado no Linkd.
>
> **Status**: 
> - ✅ SDK TypeScript: API WebSocket completa e funcional
> - ❌ Linkd: Gateway WebSocket ainda não implementado
> - 📋 Veja: `docs/WEBSOCKET-API-PROPOSAL.md` para detalhes da proposta
>
> Este guia documenta como o exemplo **deve funcionar** quando o suporte estiver completo.

Este guia explica como testar o exemplo de WebSocket Chat do Multpex Framework.

## Pré-requisitos

- **Bun** 1.3+ instalado
- **Docker** e **Docker Compose** instalados
- **Rust** 1.88+ (para compilar o Linkd)
- **PostgreSQL** 16+ (via Docker)
- **NATS** 2.10+ (via Docker)

## Estrutura do Teste

```
┌─────────────────────────────────────────────────────────────────┐
│                    WebSocket Chat Service                       │
│                 (examples/mtpx-websocket-chat)                  │
└────────────────────┬────────────────────────────────────────────┘
                     │ Unix Socket (/var/run/multpex/multpex.sock)
┌────────────────────┴────────────────────────────────────────────┐
│                   Linkd (Rust)                          │
│         HTTP Gateway + Service Registry + Auth                  │
└──────────┬──────────────────────────────┬───────────────────────┘
           │                              │
      ┌────┴────┐                    ┌────┴────┐
      │  NATS   │                    │   PG    │
      │ (msgs)  │                    │  (db)   │
      └─────────┘                    └─────────┘
```

## Passo 1: Iniciar Infraestrutura

### 1.1 Subir Docker Compose

Na raiz do projeto (`multpex-framework/`):

```bash
# Iniciar apenas a infraestrutura necessária
docker-compose up -d nats pg redis

# Verificar se os serviços estão rodando
docker-compose ps

# Verificar logs se houver problemas
docker-compose logs -f nats pg redis
```

**Portas expostas:**
- NATS: `4222` (client), `8222` (monitoring)
- PostgreSQL: `5432`
- Redis: `6379`

### 1.2 Verificar Conectividade

```bash
# Testar NATS
curl http://localhost:8222/varz

# Testar PostgreSQL
docker exec -it postgres psql -U multpex -d websocket_chat -c "SELECT version();"

# Testar Redis
docker exec -it redis redis-cli ping
```

## Passo 2: Criar Schema do Banco de Dados

O exemplo WebSocket Chat precisa das seguintes tabelas:

```bash
# Conectar ao PostgreSQL
docker exec -it postgres psql -U multpex -d websocket_chat
```

Execute o seguinte SQL:

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    avatar_url TEXT,
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'away')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL CHECK (type IN ('public', 'private', 'direct')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Room members table
CREATE TABLE IF NOT EXISTS room_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(room_id, user_id)
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'system')),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Read receipts table
CREATE TABLE IF NOT EXISTS read_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(message_id, user_id)
);

-- Create indexes for better performance
CREATE INDEX idx_chat_messages_room_id ON chat_messages(room_id);
CREATE INDEX idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX idx_room_members_room_id ON room_members(room_id);
CREATE INDEX idx_room_members_user_id ON room_members(user_id);

-- Insert test data
INSERT INTO users (id, name, email, status) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Alice', 'alice@example.com', 'online'),
    ('22222222-2222-2222-2222-222222222222', 'Bob', 'bob@example.com', 'online'),
    ('33333333-3333-3333-3333-333333333333', 'Charlie', 'charlie@example.com', 'offline')
ON CONFLICT (email) DO NOTHING;

INSERT INTO rooms (id, name, description, type, created_by) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'General', 'Main discussion room', 'public', '11111111-1111-1111-1111-111111111111'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Random', 'Off-topic discussions', 'public', '11111111-1111-1111-1111-111111111111'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Private Room', 'Private discussion', 'private', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO room_members (room_id, user_id, role) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'member'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'owner'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'member'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'owner'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'member')
ON CONFLICT DO NOTHING;

-- Verify data
SELECT 'Users:' AS table_name, COUNT(*) AS count FROM users
UNION ALL
SELECT 'Rooms:', COUNT(*) FROM rooms
UNION ALL
SELECT 'Room Members:', COUNT(*) FROM room_members;
```

Saia do psql: `\q`

## Passo 3: Compilar e Iniciar o Linkd

### 3.1 Compilar o Linkd

```bash
cd linkd

# Build em modo debug (mais rápido, ~5 segundos)
cargo build

# OU build em release (mais lento, ~2 minutos, mas melhor performance)
# cargo build --release
```

### 3.2 Configurar Variáveis de Ambiente

Crie um arquivo `.env` no diretório `linkd/`:

```bash
# linkd/.env
RUST_LOG=info,linkd=debug
NATS_URL=nats://localhost:4222
DATABASE_URL=postgresql://multpex:multpex@localhost:5432/websocket_chat
REDIS_URL=redis://localhost:6379
LINKD_SOCKET_PATH=/var/run/multpex/multpex.sock
HTTP_PORT=3000
```

### 3.3 Iniciar o Linkd

```bash
# Criar diretório para Unix socket
sudo mkdir -p /var/run/multpex
sudo chmod 777 /var/run/multpex

# Rodar o Linkd
cd linkd
cargo run
# OU se compilou em release:
# ./target/release/linkd

# Verificar se está rodando
curl http://localhost:3000/health
```

**Saída esperada:**
```json
{"status":"healthy","version":"x.x.x"}
```

## Passo 4: Instalar Dependências do WebSocket Chat

```bash
# Na raiz do projeto
cd /path/to/multpex-framework

# Instalar dependências do workspace
bun install

# Verificar que o workspace está configurado
bun --version
cat package.json  # Deve conter "@multpex/typescript-sdk": "0.9.3" em dependencies
```

## Passo 5: Executar o WebSocket Chat Service

```bash
cd examples/mtpx-websocket-chat

# Modo desenvolvimento (com hot-reload)
bun dev

# OU modo produção
# bun start
```

**Saída esperada:**
```
🔌 Starting WebSocket Chat Example

17:50:24.380 DEBUG [chat] Service initialized instanceId="9a3f38a4-..."
[Service:chat] Registered action: health (GET /chat/health)
[Service:chat] Registered action: ready (GET /chat/ready)
[Service:chat] Registered action: live (GET /chat/live)
[Service:chat] Registered action: get-room (GET /chat/rooms/:id)
[Service:chat] Registered action: create-room (POST /chat/rooms)

✅ 1 service(s) running: chat

📡 WebSocket endpoint: /ws/chat
📝 HTTP endpoints:
   - GET  /chat/rooms/:id   - Get room details
   - POST /chat/rooms       - Create a new room

Press Ctrl+C to stop.
```

## Passo 6: Testar os Endpoints HTTP

### 6.1 Health Checks

```bash
# Health endpoint
curl http://localhost:3000/chat/health

# Ready endpoint
curl http://localhost:3000/chat/ready

# Live endpoint
curl http://localhost:3000/chat/live
```

### 6.2 Criar uma Nova Sala (Room)

**Nota:** Este endpoint requer autenticação. Para teste simples, pode remover `auth: true` no código ou implementar autenticação mock.

```bash
curl -X POST http://localhost:3000/chat/rooms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Room",
    "description": "A test room",
    "type": "public"
  }'
```

### 6.3 Obter Detalhes de uma Sala

```bash
curl http://localhost:3000/chat/rooms/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
```

## Passo 7: Testar WebSocket Connection

### 7.1 Usando websocat (CLI Tool)

> ⚠️ **IMPORTANTE**: Este teste falhará com **404 Not Found** porque o gateway WebSocket ainda não está implementado no Linkd.

Instale websocat:
```bash
# macOS
brew install websocat

# Linux
cargo install websocat
```

Tentativa de conexão (retornará 404):
```bash
websocat ws://localhost:3000/ws/chat

# Erro esperado atualmente:
# websocat: WebSocketError: Received unexpected status code (404 Not Found)
```

**Por que 404?**
- O serviço chat registra o endpoint `/ws/chat` via SDK
- O Linkd ainda não implementa o gateway WebSocket
- O Linkd não sabe como fazer upgrade de HTTP para WebSocket
- A rota não é registrada no HTTP Gateway do Linkd

### 7.2 Usando JavaScript/Browser

> ⚠️ **IMPORTANTE**: Este cliente também falhará na conexão (404) até que o suporte WebSocket seja implementado no Linkd.

O arquivo `test-client.html` já existe no diretório do exemplo. Para testá-lo:

```bash
# Abrir no navegador
open test-client.html
```

**Erro esperado no console do navegador:**
```
WebSocket connection failed: Error during WebSocket handshake: Unexpected response code: 404
```

Quando o suporte WebSocket estiver implementado, crie um arquivo `test-client.html`:

```html
<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Chat Test Client</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        #messages { border: 1px solid #ccc; height: 400px; overflow-y: scroll; padding: 10px; margin: 10px 0; }
        .message { margin: 5px 0; padding: 5px; background: #f0f0f0; }
        .sent { background: #d4edda; }
        .received { background: #cce5ff; }
        input, button { padding: 8px; margin: 5px; }
        #roomId { width: 300px; }
        #messageInput { width: 400px; }
    </style>
</head>
<body>
    <h1>WebSocket Chat Test Client</h1>
    
    <div>
        <strong>Connection Status:</strong> <span id="status">Disconnected</span>
    </div>
    
    <div>
        <label>Room ID:</label>
        <input type="text" id="roomId" value="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" />
        <button onclick="joinRoom()">Join Room</button>
        <button onclick="leaveRoom()">Leave Room</button>
    </div>
    
    <div>
        <label>Message:</label>
        <input type="text" id="messageInput" placeholder="Type a message..." />
        <button onclick="sendMessage()">Send</button>
        <button onclick="sendTyping(true)">Start Typing</button>
        <button onclick="sendTyping(false)">Stop Typing</button>
    </div>
    
    <div>
        <button onclick="getHistory()">Get History</button>
        <button onclick="getRooms()">Get My Rooms</button>
        <button onclick="clearMessages()">Clear</button>
    </div>
    
    <div id="messages"></div>
    
    <script>
        let ws;
        let messageId = 0;
        let pendingRequests = new Map();
        
        function connect() {
            ws = new WebSocket('ws://localhost:3000/ws/chat');
            
            ws.onopen = () => {
                document.getElementById('status').textContent = 'Connected';
                document.getElementById('status').style.color = 'green';
                addMessage('SYSTEM', 'Connected to WebSocket server');
            };
            
            ws.onclose = () => {
                document.getElementById('status').textContent = 'Disconnected';
                document.getElementById('status').style.color = 'red';
                addMessage('SYSTEM', 'Disconnected from server');
                setTimeout(connect, 3000); // Auto-reconnect
            };
            
            ws.onerror = (error) => {
                addMessage('ERROR', 'WebSocket error: ' + error);
            };
            
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                handleMessage(msg);
            };
        }
        
        function handleMessage(msg) {
            // Check if this is a response to a request
            if (msg.id && pendingRequests.has(msg.id)) {
                const { resolve, reject } = pendingRequests.get(msg.id);
                pendingRequests.delete(msg.id);
                
                if (msg.error) {
                    reject(msg.error);
                    addMessage('ERROR', `Error: ${msg.error.message}`);
                } else {
                    resolve(msg.data);
                    addMessage('RESPONSE', JSON.stringify(msg.data, null, 2));
                }
                return;
            }
            
            // Handle broadcast events
            switch (msg.type) {
                case 'chat.message':
                    addMessage('CHAT', `${msg.data.username}: ${msg.data.content}`, 'received');
                    break;
                case 'user.joined':
                    addMessage('EVENT', `${msg.data.username} joined room`, 'received');
                    break;
                case 'user.left':
                    addMessage('EVENT', `${msg.data.username} left room`, 'received');
                    break;
                case 'user.typing':
                    addMessage('EVENT', `${msg.data.username} is ${msg.data.isTyping ? 'typing...' : 'stopped typing'}`, 'received');
                    break;
                case 'user.online':
                    addMessage('EVENT', `${msg.data.username} is online`, 'received');
                    break;
                case 'user.offline':
                    addMessage('EVENT', `${msg.data.username} is offline`, 'received');
                    break;
                default:
                    addMessage('UNKNOWN', JSON.stringify(msg, null, 2), 'received');
            }
        }
        
        function sendRequest(type, data) {
            const id = `msg-${++messageId}`;
            
            return new Promise((resolve, reject) => {
                pendingRequests.set(id, { resolve, reject });
                
                ws.send(JSON.stringify({ type, data, id }));
                addMessage('SENT', `${type}: ${JSON.stringify(data)}`, 'sent');
                
                // Timeout after 30 seconds
                setTimeout(() => {
                    if (pendingRequests.has(id)) {
                        pendingRequests.delete(id);
                        reject(new Error('Request timeout'));
                    }
                }, 30000);
            });
        }
        
        function joinRoom() {
            const roomId = document.getElementById('roomId').value;
            sendRequest('chat.join', { room: roomId });
        }
        
        function leaveRoom() {
            const roomId = document.getElementById('roomId').value;
            sendRequest('chat.leave', { room: roomId });
        }
        
        function sendMessage() {
            const roomId = document.getElementById('roomId').value;
            const message = document.getElementById('messageInput').value;
            
            if (!message) {
                alert('Please enter a message');
                return;
            }
            
            sendRequest('chat.send', { 
                room: roomId, 
                message: message 
            });
            
            document.getElementById('messageInput').value = '';
        }
        
        function sendTyping(isTyping) {
            const roomId = document.getElementById('roomId').value;
            
            // Typing indicators don't need response
            ws.send(JSON.stringify({ 
                type: 'chat.typing', 
                data: { room: roomId, isTyping: isTyping }
            }));
        }
        
        function getHistory() {
            const roomId = document.getElementById('roomId').value;
            sendRequest('chat.history', { room: roomId, limit: 50 });
        }
        
        function getRooms() {
            sendRequest('chat.rooms', {});
        }
        
        function addMessage(type, text, className = '') {
            const messagesDiv = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + className;
            messageDiv.innerHTML = `<strong>[${type}]</strong> ${text}`;
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
        
        function clearMessages() {
            document.getElementById('messages').innerHTML = '';
        }
        
        // Enter key to send message
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
        
        // Connect on load
        connect();
    </script>
</body>
</html>
```

Abra o arquivo no navegador:
```bash
open test-client.html
# OU
firefox test-client.html
```

### 7.3 Testar Fluxo Completo

1. **Conectar** - Abra o test-client.html em duas abas/janelas diferentes
2. **Join Room** - Clique em "Join Room" nas duas janelas
3. **Enviar Mensagem** - Digite uma mensagem em uma janela e clique "Send"
4. **Verificar Broadcast** - A mensagem deve aparecer na outra janela
5. **Typing Indicator** - Clique "Start Typing" e veja o evento na outra janela
6. **History** - Clique "Get History" para carregar mensagens antigas
7. **Leave Room** - Clique "Leave Room" e veja o evento de saída

## Passo 8: Troubleshooting

### Problema: "WebSocket 404 Not Found" (ATUAL)

**Sintoma:**
```bash
websocat: WebSocketError: Received unexpected status code (404 Not Found)
```

**Causa:**
O gateway WebSocket ainda não está implementado no Linkd. A API WebSocket existe no SDK TypeScript, mas o Linkd não sabe como fazer upgrade de conexões HTTP para WebSocket.

**O que funciona:**
- ✅ HTTP endpoints: `GET /chat/health`, `GET /chat/rooms/:id`, `POST /chat/rooms`
- ✅ Serviço registrado no Linkd
- ✅ SDK WebSocket API compilando sem erros

**O que NÃO funciona:**
- ❌ Conexões WebSocket em `ws://localhost:3000/ws/chat`
- ❌ Upgrade de HTTP para WebSocket
- ❌ Mensagens em tempo real

**Solução:**
Aguardar implementação do gateway WebSocket no Linkd. A proposta completa está em `docs/WEBSOCKET-API-PROPOSAL.md`.

**Implementação necessária no Linkd:**
1. HTTP upgrade handler para WebSocket
2. Gerenciamento de conexões WebSocket
3. Roteamento de mensagens WebSocket para serviços
4. Broadcasting para múltiplos clientes
5. Gerenciamento de rooms/grupos

---

### Problema: "Cannot connect to Unix socket"

**Solução:**
```bash
# Verificar se o Linkd está rodando
curl http://localhost:3000/health

# Verificar se o socket existe
ls -la /var/run/multpex/multpex.sock

# Se não existir, recriar diretório
sudo mkdir -p /var/run/multpex
sudo chmod 777 /var/run/multpex

# Reiniciar o Linkd
```

### Problema: "Database connection error"

**Solução:**
```bash
# Verificar se o PostgreSQL está rodando
docker-compose ps pg

# Verificar logs
docker-compose logs pg

# Testar conexão
docker exec -it postgres psql -U multpex -d multpex -c "SELECT 1;"
```

### Problema: "NATS connection error"

**Solução:**
```bash
# Verificar NATS
docker-compose ps nats

# Verificar logs
docker-compose logs nats

# Testar conexão
curl http://localhost:8222/varz
```

### Problema: "WebSocket authentication required"

**Solução:**

Para teste simples, você pode desabilitar autenticação no código:

```typescript
// src/services/chat.service.ts

// Remova auth: true das actions HTTP:
service.action(
  "get-room",
  { route: "/chat/rooms/:id", method: "GET" }, // Removido: auth: true
  async (ctx: HttpCtx) => {
    // ...
  }
);

// Para WebSocket, remova o middleware de auth:
// service.ws.use("chat.*", async (ctx: WsCtx, next: () => Promise<void>) => {
//   if (!ctx.auth) {
//     throw new UnauthorizedError("Authentication required");
//   }
//   await next();
// });
```

## Passo 9: Logs e Debugging

### Ver logs do serviço WebSocket Chat

```bash
# Os logs aparecem no terminal onde você executou `bun dev`
# Para aumentar o nível de log, defina DEBUG=true:

DEBUG=true bun dev
```

### Ver logs do Linkd

```bash
# No terminal onde o Linkd está rodando
# Para mais detalhes:

RUST_LOG=debug cargo run
```

### Ver logs dos containers Docker

```bash
# NATS
docker-compose logs -f nats

# PostgreSQL
docker-compose logs -f pg

# Redis
docker-compose logs -f redis
```

## Passo 10: Limpeza

Quando terminar os testes:

```bash
# Parar o serviço WebSocket Chat (Ctrl+C no terminal)

# Parar o Linkd (Ctrl+C no terminal)

# Parar containers Docker
docker-compose down

# Limpar volumes (CUIDADO: apaga dados do banco)
docker-compose down -v

# Limpar socket Unix
sudo rm -rf /var/run/multpex
```

## Métricas de Sucesso

### Atualmente Funcionando ✅

✅ Infraestrutura (NATS, PostgreSQL, Redis) rodando
✅ Linkd conectado e respondendo em `http://localhost:3000/health`
✅ WebSocket Chat service registrado no Linkd
✅ HTTP endpoints respondendo corretamente:
  - `GET /chat/health` → 200 OK
  - `GET /chat/ready` → 200 OK
  - `GET /chat/rooms/:id` → Retorna detalhes da sala
  - `POST /chat/rooms` → Cria nova sala

### Aguardando Implementação ⏳

⏳ WebSocket connection estabelecida (404 atualmente)
⏳ Mensagens sendo enviadas e recebidas entre clientes
⏳ Eventos de typing, join, leave funcionando
⏳ Histórico de mensagens sendo carregado
⏳ Broadcasting em tempo real

**Status**: SDK TypeScript pronto, aguardando implementação do gateway WebSocket no Linkd.

## Próximos Passos

### Prioritário (Infraestrutura)

1. **Implementar Gateway WebSocket no Linkd** ⚠️ BLOQUEANTE
   - HTTP to WebSocket upgrade handler
   - Gerenciamento de conexões ativas
   - Roteamento de mensagens para serviços via Unix socket
   - Broadcasting para múltiplos clientes
   - Suporte a rooms/grupos

### SDK e Aplicação (Quando WebSocket estiver pronto)

- Implementar autenticação JWT real para WebSocket
- Adicionar testes unitários com Bun Test
- Adicionar testes de integração end-to-end
- Implementar rate limiting por usuário
- Adicionar compressão de mensagens (permessage-deflate)
- Implementar presença de usuários (online/offline)
- Adicionar suporte a arquivos/imagens via upload
- Implementar notificações push

## Como Contribuir

Se você deseja implementar o gateway WebSocket no Linkd:

1. Leia a proposta completa: `docs/WEBSOCKET-API-PROPOSAL.md`
2. Principais componentes necessários:
   - Axum WebSocket upgrade handler
   - Gerenciador de conexões (ConnectionManager)
   - Protocolo de comunicação SDK ↔ Linkd via Unix socket
   - Sistema de broadcasting e rooms
3. Referências úteis:
   - [Axum WebSocket Example](https://github.com/tokio-rs/axum/tree/main/examples/websockets)
   - [RFC 6455 - WebSocket Protocol](https://tools.ietf.org/html/rfc6455)

## Referências

- [Multpex Framework README](../../README.md)
- [TypeScript SDK Documentation](https://docusaurus.devops.multpex.com.br/docs/mtpx-framework/intro)
- [Linkd Documentation](../../linkd/README.md)
- [WebSocket Protocol RFC 6455](https://tools.ietf.org/html/rfc6455)
