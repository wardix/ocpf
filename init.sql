-- =========================================================================
-- Database Schema for Omnichannel Platform (PostgreSQL) - V3 Architecture
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Custom Types (ENUMs)
-- -------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('administrator', 'agent');
CREATE TYPE availability_status AS ENUM ('online', 'busy', 'offline');
CREATE TYPE provider_type AS ENUM ('whatsapp', 'facebook', 'web_widget', 'api', 'telegram');
CREATE TYPE conversation_status AS ENUM ('open', 'pending', 'snoozed', 'resolved');
CREATE TYPE sender_type AS ENUM ('Contact', 'User', 'System');
CREATE TYPE message_type AS ENUM ('incoming', 'outgoing', 'template');
CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read', 'failed');

-- -------------------------------------------------------------------------
-- 2. Core & Users
-- -------------------------------------------------------------------------
CREATE TABLE accounts (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE account_users (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role user_role DEFAULT 'agent',
    availability_status availability_status DEFAULT 'offline',
    UNIQUE (account_id, user_id)
);

-- -------------------------------------------------------------------------
-- 3. Routing & Contacts
-- -------------------------------------------------------------------------
CREATE TABLE channels (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    provider_type provider_type NOT NULL,
    provider_config JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE inboxes (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    greeting_message TEXT
);

CREATE TABLE inbox_settings (
    id BIGSERIAL PRIMARY KEY,
    inbox_id BIGINT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    auto_assignment_enabled BOOLEAN DEFAULT FALSE,
    auto_assignment_algorithm VARCHAR(20) DEFAULT 'round_robin' CHECK (auto_assignment_algorithm IN ('round_robin', 'least_busy')),
    auto_assignment_max_tickets INTEGER DEFAULT 10,
    last_assigned_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (inbox_id)
);


CREATE TABLE contacts (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone_number VARCHAR(255),
    avatar_url VARCHAR(1024),
    custom_attributes JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contact_inboxes (
    id BIGSERIAL PRIMARY KEY,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    inbox_id BIGINT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    source_id VARCHAR(255) NOT NULL, -- ID unik dari platform asli (cth: nomor WA)
    UNIQUE (inbox_id, source_id)
);

-- -------------------------------------------------------------------------
-- 4. Conversations, Tickets, & Messages
-- -------------------------------------------------------------------------
-- Wadah abadi untuk semua histori interaksi antara Pelanggan dan Inbox tertentu
CREATE TABLE conversations (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    inbox_id BIGINT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Siklus hidup spesifik dari sebuah issue / percakapan aktif
CREATE TABLE tickets (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    assignee_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status conversation_status DEFAULT 'open',
    is_bot_active BOOLEAN DEFAULT TRUE,
    bot_state VARCHAR(255) DEFAULT 'start',
    snoozed_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
    sender_type sender_type NOT NULL,
    sender_id BIGINT, -- ID of the Contact, User, or NULL if System
    content TEXT,
    message_type message_type NOT NULL,
    is_private BOOLEAN DEFAULT FALSE,
    status message_status DEFAULT 'sent',
    wa_message_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE attachments (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_type VARCHAR(255) NOT NULL,
    file_url VARCHAR(1024) NOT NULL,
    original_filename VARCHAR(255)
);

CREATE TABLE conversation_events (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
    actor_type VARCHAR(50), 
    actor_id BIGINT,        
    event_type VARCHAR(50), 
    event_data JSONB,       
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------------------
-- 5. Canned Responses
-- -------------------------------------------------------------------------
CREATE TABLE canned_responses (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    short_code VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, short_code)
);

-- -------------------------------------------------------------------------
-- 6. Tags / Labels
-- -------------------------------------------------------------------------
CREATE TABLE labels (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    color VARCHAR(7) NOT NULL,
    UNIQUE (account_id, title)
);

CREATE TABLE conversation_labels (
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    label_id BIGINT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, label_id)
);

-- -------------------------------------------------------------------------
-- 7. Indexes for Performance (Important for high concurrency)
-- -------------------------------------------------------------------------
CREATE INDEX idx_conversations_account_id ON conversations(account_id);
CREATE INDEX idx_conversations_inbox_id ON conversations(inbox_id);
CREATE INDEX idx_conversations_contact_id ON conversations(contact_id);

CREATE INDEX idx_inbox_settings_inbox_id ON inbox_settings(inbox_id);
CREATE INDEX idx_inbox_settings_account_id ON inbox_settings(account_id);

CREATE INDEX idx_tickets_conversation_id ON tickets(conversation_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_assignee_id ON tickets(assignee_id);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_ticket_id ON messages(ticket_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_conversation_id_created_at ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_account_id_created_at ON messages(account_id, created_at);
CREATE INDEX idx_messages_wa_message_id ON messages(wa_message_id);

CREATE INDEX idx_contact_inboxes_source_id ON contact_inboxes(source_id);
