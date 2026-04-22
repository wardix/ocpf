-- =========================================================================
-- Database Schema for Omnichannel Platform (PostgreSQL)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Custom Types (ENUMs)
-- -------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('administrator', 'agent');
CREATE TYPE availability_status AS ENUM ('online', 'busy', 'offline');
CREATE TYPE provider_type AS ENUM ('whatsapp', 'facebook', 'web_widget', 'api');
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
-- 4. Conversations & Messages
-- -------------------------------------------------------------------------
CREATE TABLE conversations (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    inbox_id BIGINT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    assignee_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status conversation_status DEFAULT 'open',
    snoozed_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type sender_type NOT NULL,
    sender_id BIGINT, -- ID of the Contact, User, or NULL if System
    content TEXT,
    message_type message_type NOT NULL,
    is_private BOOLEAN DEFAULT FALSE,
    status message_status DEFAULT 'sent',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE attachments (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_type VARCHAR(255) NOT NULL,
    file_url VARCHAR(1024) NOT NULL
);

-- -------------------------------------------------------------------------
-- 5. Tags / Labels
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
-- 6. Indexes for Performance (Important for high concurrency)
-- -------------------------------------------------------------------------
CREATE INDEX idx_conversations_account_id ON conversations(account_id);
CREATE INDEX idx_conversations_inbox_id ON conversations(inbox_id);
CREATE INDEX idx_conversations_contact_id ON conversations(contact_id);
CREATE INDEX idx_conversations_status ON conversations(status);

-- Messages will grow very large, indexing is crucial here
CREATE INDEX idx_messages_conversation_id_created_at ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_account_id_created_at ON messages(account_id, created_at);

CREATE INDEX idx_contact_inboxes_source_id ON contact_inboxes(source_id);