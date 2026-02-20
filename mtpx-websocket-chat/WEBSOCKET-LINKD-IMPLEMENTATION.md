# WebSocket Implementation Guide for Linkd

Este documento descreve o que precisa ser implementado no Linkd para suportar WebSockets.

## Status Atual

### ✅ Implementado (SDK TypeScript)

- API WebSocket completa e ergonômica
- Handlers de mensagem (`service.ws.on()`)
- Lifecycle handlers (`onConnect`, `onDisconnect`)
- Middleware support (`service.ws.use()`)
- Grouping (`service.ws.group()`)
- Broadcasting API (`ctx.to(room).emit()`)
- Typed WebSocket context
- Validation com Zod

### ❌ Não Implementado (Linkd)

- HTTP to WebSocket upgrade handler
- Gerenciamento de conexões WebSocket
- Roteamento de mensagens WebSocket para serviços
- Broadcasting para múltiplos clientes
- Sistema de rooms/grupos
- Protocolo de comunicação Linkd ↔ SDK via Unix socket

## Arquitetura Proposta

```
┌─────────────────────────────────────────────────────────────┐
│                    Cliente (Browser/App)                    │
└───────────────────────┬─────────────────────────────────────┘
                        │ WebSocket (ws://localhost:3000/ws/*)
┌───────────────────────┴─────────────────────────────────────┐
│                    Linkd (Rust - Linkd)                   │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │           HTTP Gateway (Axum)                      │    │
│  │  - HTTP Router: /api/users, /api/posts            │    │
│  │  - WebSocket Upgrade: /ws/* → WebSocketManager    │    │
│  └────────────────────────────────────────────────────┘    │
│                        │                                    │
│  ┌────────────────────┴────────────────────────────────┐   │
│  │         WebSocket Manager (NOVO)                    │   │
│  │  - Connection Pool                                  │   │
│  │  - Room Manager                                     │   │
│  │  - Message Router                                   │   │
│  │  - Broadcasting Engine                              │   │
│  └────────────────────────────────────────────────────┘    │
│                        │                                    │
│                        │ Protobuf via Unix Socket           │
└────────────────────────┴────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│              SDK TypeScript (Service)                       │
│  - service.ws.onConnect()                                   │
│  - service.ws.on("chat.send", handler)                      │
│  - ctx.to(room).emit("chat.message", data)                  │
└─────────────────────────────────────────────────────────────┘
```

## Implementação Detalhada

### 1. HTTP to WebSocket Upgrade Handler

**Arquivo**: `linkd/src/gateway/websocket_handler.rs`

```rust
use axum::extract::ws::{WebSocket, WebSocketUpgrade};
use axum::response::Response;
use std::sync::Arc;

pub struct WebSocketHandler {
    connection_manager: Arc<ConnectionManager>,
    service_registry: Arc<ServiceRegistry>,
}

impl WebSocketHandler {
    /// Handle HTTP upgrade to WebSocket
    pub async fn handle_upgrade(
        ws: WebSocketUpgrade,
        path: String,
        user: Option<AuthenticatedUser>,
    ) -> Response {
        // 1. Verificar se o path está registrado (ex: /ws/chat)
        let service_name = self.find_service_for_path(&path)?;
        
        // 2. Fazer upgrade para WebSocket
        ws.on_upgrade(move |socket| {
            self.handle_socket(socket, service_name, path, user)
        })
    }
    
    async fn handle_socket(
        &self,
        socket: WebSocket,
        service_name: String,
        path: String,
        user: Option<AuthenticatedUser>,
    ) {
        let conn_id = uuid::Uuid::new_v4().to_string();
        
        // 3. Criar conexão e registrar no manager
        let connection = Connection::new(conn_id.clone(), socket, user);
        self.connection_manager.add(conn_id.clone(), connection).await;
        
        // 4. Notificar serviço sobre nova conexão
        self.notify_service_connect(service_name.clone(), conn_id.clone()).await;
        
        // 5. Loop de processamento de mensagens
        self.message_loop(conn_id, service_name).await;
        
        // 6. Cleanup ao desconectar
        self.connection_manager.remove(&conn_id).await;
        self.notify_service_disconnect(service_name, conn_id).await;
    }
}
```

**Integração com Axum Router**:

```rust
// linkd/src/gateway/mod.rs

pub fn create_router() -> Router {
    Router::new()
        // HTTP routes
        .route("/*path", any(handle_http_request))
        // WebSocket upgrade (NOVO)
        .route("/ws/*path", get(handle_websocket_upgrade))
}

async fn handle_websocket_upgrade(
    ws: WebSocketUpgrade,
    Path(path): Path<String>,
    Extension(auth): Extension<Option<AuthenticatedUser>>,
    Extension(ws_handler): Extension<Arc<WebSocketHandler>>,
) -> Response {
    ws_handler.handle_upgrade(ws, format!("/ws/{}", path), auth).await
}
```

### 2. Connection Manager

**Arquivo**: `linkd/src/websocket/connection_manager.rs`

```rust
use dashmap::DashMap;
use tokio::sync::mpsc;

pub struct Connection {
    pub id: String,
    pub user_id: Option<String>,
    pub socket: WebSocket,
    pub rooms: Arc<RwLock<HashSet<String>>>,
    pub tx: mpsc::UnboundedSender<Message>,
    pub rx: mpsc::UnboundedReceiver<Message>,
}

pub struct ConnectionManager {
    connections: Arc<DashMap<String, Connection>>,
    room_manager: Arc<RoomManager>,
}

impl ConnectionManager {
    pub async fn add(&self, conn_id: String, connection: Connection) {
        self.connections.insert(conn_id, connection);
    }
    
    pub async fn remove(&self, conn_id: &str) {
        if let Some((_, conn)) = self.connections.remove(conn_id) {
            // Remove from all rooms
            let rooms = conn.rooms.read().await.clone();
            for room in rooms {
                self.room_manager.leave(conn_id, &room).await;
            }
        }
    }
    
    pub async fn send_to(&self, conn_id: &str, message: Message) -> Result<()> {
        if let Some(conn) = self.connections.get(conn_id) {
            conn.tx.send(message)?;
        }
        Ok(())
    }
    
    pub async fn broadcast_to_room(&self, room: &str, message: Message, except: Option<&str>) {
        let conn_ids = self.room_manager.get_members(room).await;
        
        for conn_id in conn_ids {
            if Some(conn_id.as_str()) == except {
                continue;
            }
            let _ = self.send_to(&conn_id, message.clone()).await;
        }
    }
}
```

### 3. Room Manager

**Arquivo**: `linkd/src/websocket/room_manager.rs`

```rust
use dashmap::DashMap;
use std::collections::HashSet;

pub struct RoomManager {
    /// room_id -> Set<connection_id>
    rooms: Arc<DashMap<String, HashSet<String>>>,
}

impl RoomManager {
    pub async fn join(&self, conn_id: String, room: String) {
        self.rooms
            .entry(room)
            .or_insert_with(HashSet::new)
            .insert(conn_id);
    }
    
    pub async fn leave(&self, conn_id: &str, room: &str) {
        if let Some(mut members) = self.rooms.get_mut(room) {
            members.remove(conn_id);
            if members.is_empty() {
                drop(members);
                self.rooms.remove(room);
            }
        }
    }
    
    pub async fn get_members(&self, room: &str) -> Vec<String> {
        self.rooms
            .get(room)
            .map(|members| members.iter().cloned().collect())
            .unwrap_or_default()
    }
    
    pub async fn get_rooms_for_connection(&self, conn_id: &str) -> Vec<String> {
        self.rooms
            .iter()
            .filter(|entry| entry.value().contains(conn_id))
            .map(|entry| entry.key().clone())
            .collect()
    }
}
```

### 4. Protocolo de Comunicação (Linkd ↔ SDK)

**Protobuf Messages** (adicionar ao `proto/messages.proto`):

```protobuf
// WebSocket Connection Event (Linkd → SDK)
message WebSocketConnectionEvent {
  string connection_id = 1;
  string service_name = 2;
  string path = 3;
  optional multpex.UserContext user = 4;
  string remote_address = 5;
  EventType event_type = 6;
  
  enum EventType {
    CONNECTED = 0;
    DISCONNECTED = 1;
  }
}

// WebSocket Inbound Message (Linkd → SDK)
message WebSocketInbound {
  string connection_id = 1;
  string service_name = 2;
  string message_type = 3;    // Ex: "chat.send"
  bytes payload = 4;           // JSON payload
  optional string correlation_id = 5;
}

// WebSocket Outbound Message (SDK → Linkd)
message WebSocketOutbound {
  oneof target {
    string connection_id = 1;   // Send to specific connection
    string room = 2;             // Broadcast to room
    bool broadcast_all = 3;      // Broadcast to all
  }
  
  string event = 4;              // Event name (ex: "chat.message")
  bytes payload = 5;             // JSON payload
  repeated string except_connections = 6;  // Exclude these connections
}

// WebSocket Room Operation (SDK → Linkd)
message WebSocketRoomOperation {
  string connection_id = 1;
  string room = 2;
  OperationType operation = 3;
  
  enum OperationType {
    JOIN = 0;
    LEAVE = 1;
  }
}

// WebSocket Response (SDK → Linkd)
message WebSocketResponse {
  string connection_id = 1;
  string correlation_id = 2;
  oneof response {
    bytes data = 3;              // Success response (JSON)
    multpex.ErrorResponse error = 4;  // Error response
  }
}
```

**Wrapper Message** (atualizar `ServiceMessage`):

```protobuf
message ServiceMessage {
  oneof message {
    // ... existing messages
    WebSocketConnectionEvent ws_connection_event = 20;
    WebSocketInbound ws_inbound = 21;
    WebSocketOutbound ws_outbound = 22;
    WebSocketRoomOperation ws_room_operation = 23;
    WebSocketResponse ws_response = 24;
  }
}
```

### 5. Message Router

**Arquivo**: `linkd/src/websocket/message_router.rs`

```rust
pub struct MessageRouter {
    connection_manager: Arc<ConnectionManager>,
    service_sockets: Arc<DashMap<String, UnixStream>>,
}

impl MessageRouter {
    /// Route inbound WebSocket message to appropriate service
    pub async fn route_inbound(
        &self,
        conn_id: String,
        service_name: String,
        message: WebSocketMessage,
    ) -> Result<()> {
        // 1. Build protobuf message
        let ws_inbound = WebSocketInbound {
            connection_id: conn_id.clone(),
            service_name: service_name.clone(),
            message_type: message.message_type,
            payload: message.payload.into_bytes(),
            correlation_id: message.id,
        };
        
        let service_msg = ServiceMessage {
            message: Some(service_message::Message::WsInbound(ws_inbound)),
        };
        
        // 2. Send to service via Unix socket
        if let Some(socket) = self.service_sockets.get(&service_name) {
            send_protobuf_message(&socket, &service_msg).await?;
        }
        
        Ok(())
    }
    
    /// Route outbound message from service to WebSocket clients
    pub async fn route_outbound(
        &self,
        outbound: WebSocketOutbound,
    ) -> Result<()> {
        let message = Message::text(String::from_utf8(outbound.payload)?);
        
        match outbound.target {
            Some(Target::ConnectionId(conn_id)) => {
                // Send to specific connection
                self.connection_manager.send_to(&conn_id, message).await?;
            }
            Some(Target::Room(room)) => {
                // Broadcast to room
                let except = if outbound.except_connections.is_empty() {
                    None
                } else {
                    Some(outbound.except_connections[0].as_str())
                };
                self.connection_manager.broadcast_to_room(&room, message, except).await;
            }
            Some(Target::BroadcastAll(true)) => {
                // Broadcast to all connections
                for conn in self.connection_manager.connections.iter() {
                    let _ = self.connection_manager.send_to(conn.key(), message.clone()).await;
                }
            }
            _ => {}
        }
        
        Ok(())
    }
    
    /// Handle room operation from service
    pub async fn handle_room_operation(
        &self,
        operation: WebSocketRoomOperation,
    ) -> Result<()> {
        match operation.operation() {
            OperationType::Join => {
                self.connection_manager.room_manager.join(
                    operation.connection_id,
                    operation.room,
                ).await;
            }
            OperationType::Leave => {
                self.connection_manager.room_manager.leave(
                    &operation.connection_id,
                    &operation.room,
                ).await;
            }
        }
        Ok(())
    }
}
```

### 6. Integração com Service Registry

**Arquivo**: `linkd/src/registry/service.rs` (modificar)

```rust
pub struct RegisteredService {
    pub name: String,
    pub version: String,
    pub namespace: String,
    pub actions: Vec<RegisteredAction>,
    pub socket: UnixStream,
    
    // NOVO: WebSocket configuration
    pub websocket_config: Option<WebSocketConfig>,
}

#[derive(Debug, Clone)]
pub struct WebSocketConfig {
    pub enabled: bool,
    pub path: String,  // Ex: "/ws/chat"
    pub heartbeat_interval_ms: u32,
    pub max_connections_per_user: u32,
    pub max_message_size_bytes: u32,
}

impl ServiceRegistry {
    pub fn register_websocket_path(
        &self,
        service_name: String,
        config: WebSocketConfig,
    ) {
        // Registrar path WebSocket no router
        self.websocket_paths.insert(config.path.clone(), service_name);
    }
    
    pub fn find_service_for_websocket_path(&self, path: &str) -> Option<String> {
        self.websocket_paths.get(path).map(|s| s.clone())
    }
}
```

### 7. Message Loop (Connection Handler)

```rust
async fn message_loop(
    conn_id: String,
    service_name: String,
    mut socket: WebSocket,
    router: Arc<MessageRouter>,
) {
    let (mut tx, mut rx) = socket.split();
    
    // Spawn task to send messages to client
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if tx.send(msg).await.is_err() {
                break;
            }
        }
    });
    
    // Receive messages from client
    while let Some(msg_result) = socket.recv().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                // Parse JSON message
                let ws_message: WebSocketMessage = serde_json::from_str(&text)?;
                
                // Route to service
                router.route_inbound(
                    conn_id.clone(),
                    service_name.clone(),
                    ws_message,
                ).await?;
            }
            Ok(Message::Binary(data)) => {
                // Handle binary messages if needed
            }
            Ok(Message::Ping(data)) => {
                let _ = socket.send(Message::Pong(data)).await;
            }
            Ok(Message::Close(_)) => {
                break;
            }
            Err(e) => {
                eprintln!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }
    
    send_task.abort();
}
```

## Dependências Necessárias

Adicionar ao `linkd/Cargo.toml`:

```toml
[dependencies]
axum = { version = "0.7", features = ["ws"] }
tokio-tungstenite = "0.21"  # WebSocket implementation
dashmap = "6.0"              # Concurrent HashMap
uuid = { version = "1.0", features = ["v4", "serde"] }
```

## Testes

### Teste Unitário: Room Manager

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_room_join_leave() {
        let room_manager = RoomManager::new();
        
        // Join room
        room_manager.join("conn-1".to_string(), "room-a".to_string()).await;
        room_manager.join("conn-2".to_string(), "room-a".to_string()).await;
        
        // Check members
        let members = room_manager.get_members("room-a").await;
        assert_eq!(members.len(), 2);
        
        // Leave room
        room_manager.leave("conn-1", "room-a").await;
        
        let members = room_manager.get_members("room-a").await;
        assert_eq!(members.len(), 1);
    }
}
```

### Teste de Integração: WebSocket Connection

```rust
#[tokio::test]
async fn test_websocket_connection() {
    // Start Linkd server
    let server = start_linkd_server().await;
    
    // Connect WebSocket client
    let (mut socket, _) = connect_async("ws://localhost:3000/ws/chat")
        .await
        .expect("Failed to connect");
    
    // Send message
    let msg = json!({
        "type": "chat.send",
        "data": {
            "room": "test-room",
            "message": "Hello"
        },
        "id": "msg-1"
    });
    
    socket.send(Message::Text(msg.to_string())).await.unwrap();
    
    // Receive response
    let response = socket.next().await.unwrap().unwrap();
    assert!(response.is_text());
}
```

## Checklist de Implementação

### Fase 1: Estrutura Básica
- [ ] Criar `linkd/src/websocket/` module
- [ ] Implementar `Connection` struct
- [ ] Implementar `ConnectionManager`
- [ ] Implementar `RoomManager`
- [ ] Adicionar mensagens Protobuf para WebSocket

### Fase 2: Gateway Integration
- [ ] Implementar `WebSocketHandler`
- [ ] Adicionar rota WebSocket no Axum router
- [ ] Implementar HTTP to WebSocket upgrade
- [ ] Implementar message loop (recv/send)

### Fase 3: Message Routing
- [ ] Implementar `MessageRouter`
- [ ] Rotear mensagens inbound (cliente → serviço)
- [ ] Rotear mensagens outbound (serviço → cliente)
- [ ] Implementar operações de room (join/leave)

### Fase 4: Service Registry Integration
- [ ] Adicionar `WebSocketConfig` ao `RegisteredService`
- [ ] Registrar paths WebSocket no registry
- [ ] Implementar descoberta de serviço por path WebSocket

### Fase 5: Features Avançadas
- [ ] Implementar heartbeat (ping/pong)
- [ ] Implementar rate limiting por conexão
- [ ] Implementar compressão (permessage-deflate)
- [ ] Implementar max connections per user
- [ ] Implementar graceful shutdown

### Fase 6: Testes
- [ ] Testes unitários (RoomManager, ConnectionManager)
- [ ] Testes de integração (conexão, mensagens, broadcasting)
- [ ] Testes de carga (múltiplas conexões, broadcasting)
- [ ] Testes de falha (disconnect, timeout, invalid messages)

## Exemplo de Uso (Após Implementação)

### No SDK (Já Funciona)

```typescript
// examples/mtpx-websocket-chat/src/services/chat.service.ts

service.ws.onConnect(async (ctx) => {
  ctx.logger.info("Client connected", { socketId: ctx.socket.id });
  await ctx.join("lobby");
});

service.ws.on("chat.send", async (ctx) => {
  const { room, message } = ctx.message;
  
  await ctx.db.chat_messages.insert({
    room_id: room,
    user_id: ctx.auth.userId,
    content: message,
  });
  
  await ctx.to(room).emit("chat.message", {
    userId: ctx.auth.userId,
    content: message,
  });
  
  return { success: true };
});
```

### Do Cliente (JavaScript)

```javascript
const ws = new WebSocket("ws://localhost:3000/ws/chat");

ws.onopen = () => {
  // Join room
  ws.send(JSON.stringify({
    type: "chat.join",
    data: { room: "room-123" },
    id: "msg-1"
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === "chat.message") {
    console.log(`${msg.data.userId}: ${msg.data.content}`);
  }
};
```

## Estimativa de Tempo

- **Fase 1**: ~3-4 dias (estrutura básica)
- **Fase 2**: ~2-3 dias (gateway integration)
- **Fase 3**: ~2-3 dias (message routing)
- **Fase 4**: ~1 dia (registry integration)
- **Fase 5**: ~2-3 dias (features avançadas)
- **Fase 6**: ~2-3 dias (testes)

**Total**: ~12-17 dias (2-3 semanas) para implementação completa

## Referências

- [Axum WebSocket Example](https://github.com/tokio-rs/axum/tree/main/examples/websockets)
- [RFC 6455 - WebSocket Protocol](https://tools.ietf.org/html/rfc6455)
- [Tokio Tungstenite Documentation](https://docs.rs/tokio-tungstenite)
- [WebSocket API Proposal](../../../docs/WEBSOCKET-API-PROPOSAL.md)
