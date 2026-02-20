#!/bin/bash
# =============================================================================
# WebSocket Chat Example - Test Environment Setup Script
# =============================================================================
# Este script automatiza a preparação do ambiente de teste para o exemplo
# de WebSocket Chat do Multpex Framework.
#
# Uso:
#   ./setup-test.sh
#
# O script irá:
#   1. Iniciar a infraestrutura (NATS, PostgreSQL, Redis)
#   2. Criar banco de dados dedicado (websocket_chat)
#   3. Criar o schema do banco de dados
#   4. Inserir dados de teste
# =============================================================================

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

# Configurações
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"

# Database dedicado para este exemplo
DB_NAME="websocket_chat"
DB_USER="multpex"

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}WebSocket Chat - Test Environment Setup${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

# =============================================================================
# Função: Verificar se um comando existe
# =============================================================================
check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}Erro: '$1' não encontrado${NC}"
        echo -e "   Por favor, instale $2"
        exit 1
    fi
}

# =============================================================================
# Passo 1: Verificar Pré-requisitos
# =============================================================================
echo -e "${BLUE}[1/5] Verificando pré-requisitos...${NC}"

check_command "docker" "Docker (https://docs.docker.com/get-docker/)"
check_command "bun" "Bun (https://bun.sh)"

echo -e "${GREEN}OK${NC} Todos os pré-requisitos instalados"
echo ""

# =============================================================================
# Passo 2: Iniciar Infraestrutura
# =============================================================================
echo -e "${BLUE}[2/5] Iniciando infraestrutura...${NC}"

cd "$PROJECT_ROOT"

# Iniciar containers necessários (nomes corretos do docker-compose.yml)
# Nota: o serviço é "pg" mas o container é nomeado "postgres"
docker compose up -d nats pg redis 2>/dev/null || \
docker-compose up -d nats pg redis 2>/dev/null || {
    echo -e "${RED}Erro ao iniciar containers${NC}"
    exit 1
}

# Aguardar PostgreSQL ficar pronto
echo -n "   Aguardando PostgreSQL..."
for i in {1..30}; do
    if docker exec postgres pg_isready -U $DB_USER >/dev/null 2>&1; then
        echo -e " ${GREEN}OK${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

echo ""

# =============================================================================
# Passo 3: Criar Banco de Dados Dedicado
# =============================================================================
echo -e "${BLUE}[3/5] Criando banco de dados '${DB_NAME}'...${NC}"

# Criar database se não existir
docker exec postgres psql -U $DB_USER -d postgres -c \
    "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 || \
docker exec postgres psql -U $DB_USER -d postgres -c \
    "CREATE DATABASE ${DB_NAME};"

echo -e "${GREEN}OK${NC} Banco de dados '${DB_NAME}' pronto"
echo ""

# =============================================================================
# Passo 4: Criar Schema
# =============================================================================
echo -e "${BLUE}[4/5] Criando schema...${NC}"

docker exec postgres psql -U $DB_USER -d $DB_NAME -c "
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    avatar_url TEXT,
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'away')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL CHECK (type IN ('public', 'private', 'direct')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Room members table
CREATE TABLE IF NOT EXISTS room_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);
"

echo -e "${GREEN}OK${NC} Schema criado"
echo ""

# =============================================================================
# Passo 5: Inserir Dados de Teste
# =============================================================================
echo -e "${BLUE}[5/5] Inserindo dados de teste...${NC}"

docker exec postgres psql -U $DB_USER -d $DB_NAME -c "
-- Test users
INSERT INTO users (id, name, email, status) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Alice', 'alice@example.com', 'online'),
    ('22222222-2222-2222-2222-222222222222', 'Bob', 'bob@example.com', 'online'),
    ('33333333-3333-3333-3333-333333333333', 'Charlie', 'charlie@example.com', 'offline')
ON CONFLICT (email) DO NOTHING;

-- Test rooms
INSERT INTO rooms (id, name, description, type, created_by) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'General', 'Main discussion room', 'public', '11111111-1111-1111-1111-111111111111'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Random', 'Off-topic discussions', 'public', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

-- Room members
INSERT INTO room_members (room_id, user_id, role) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'member'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'owner'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'member')
ON CONFLICT DO NOTHING;

-- Test messages
INSERT INTO chat_messages (room_id, user_id, content, message_type) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Hello everyone!', 'text'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'Hi Alice!', 'text')
ON CONFLICT DO NOTHING;
"

echo -e "${GREEN}OK${NC} Dados de teste inseridos"
echo ""

# Mostrar contagem
echo -e "${DIM}Dados criados:${NC}"
docker exec postgres psql -U $DB_USER -d $DB_NAME -t -c "
SELECT '  Users: ' || COUNT(*) FROM users
UNION ALL SELECT '  Rooms: ' || COUNT(*) FROM rooms
UNION ALL SELECT '  Members: ' || COUNT(*) FROM room_members
UNION ALL SELECT '  Messages: ' || COUNT(*) FROM chat_messages;
"

echo ""
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}Setup Completo!${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo -e "Próximos passos:"
echo ""
echo -e "1. Iniciar o Linkd (com DATABASE_URL correto):"
echo -e "   ${DIM}cd $PROJECT_ROOT/linkd${NC}"
echo -e "   ${DIM}DATABASE_URL=postgres://multpex:multpex@localhost:5432/${DB_NAME} cargo run${NC}"
echo ""
echo -e "2. Em outro terminal, iniciar o WebSocket Chat:"
echo -e "   ${DIM}cd $PROJECT_ROOT/examples/websocket-chat${NC}"
echo -e "   ${DIM}DATABASE_URL=postgres://multpex:multpex@localhost:5432/${DB_NAME} bun dev${NC}"
echo ""
echo -e "3. Testar:"
echo -e "   ${DIM}curl http://localhost:3000/chat/health${NC}"
echo ""
echo -e "Database: ${YELLOW}${DB_NAME}${NC}"
echo -e "Room ID para teste: ${YELLOW}aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa${NC}"
echo ""
