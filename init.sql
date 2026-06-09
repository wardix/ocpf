-- =========================================================================
-- Database Schema for Omnichannel Platform (PostgreSQL) - V3 Architecture
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Custom Types (ENUMs)
-- -------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('administrator', 'agent');
CREATE TYPE team_member_role AS ENUM ('member', 'leader');
CREATE TYPE availability_status AS ENUM ('online', 'busy', 'offline');
CREATE TYPE provider_type AS ENUM ('whatsapp', 'facebook', 'web_widget', 'api', 'telegram', 'email');
CREATE TYPE conversation_status AS ENUM ('open', 'pending', 'snoozed', 'resolved');
CREATE TYPE sender_type AS ENUM ('Contact', 'User', 'System');
CREATE TYPE message_type AS ENUM ('incoming', 'outgoing', 'template');
CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read', 'failed');
CREATE TYPE notification_type AS ENUM (
    'conversation_assigned', 
    'mentioned_in_note', 
    'snoozed_ticket_due', 
    'broadcast_completed', 
    'new_conversation'
);

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

CREATE TABLE teams (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, name)
);

CREATE TABLE team_members (
    id BIGSERIAL PRIMARY KEY,
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role team_member_role DEFAULT 'member',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (team_id, user_id)
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
    greeting_message TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    avatar_url VARCHAR(1024),
    widget_config JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inbox_settings (
    id BIGSERIAL PRIMARY KEY,
    inbox_id BIGINT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    auto_assignment_enabled BOOLEAN DEFAULT FALSE,
    auto_assignment_algorithm VARCHAR(20) DEFAULT 'round_robin' CHECK (auto_assignment_algorithm IN ('round_robin', 'least_busy')),
    auto_assignment_max_tickets INTEGER DEFAULT 10,
    last_assigned_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    csat_enabled BOOLEAN DEFAULT FALSE,
    csat_delay_minutes INTEGER DEFAULT 5,
    csat_message TEXT DEFAULT 'Terima kasih telah menghubungi kami! Bagaimana penilaian Anda terhadap layanan kami? Reply 1-5 (1=Sangat Buruk, 5=Sangat Baik)',
    business_hours_enabled BOOLEAN DEFAULT FALSE,
    timezone VARCHAR(50) DEFAULT 'Asia/Jakarta',
    out_of_office_message TEXT DEFAULT 'Terima kasih telah menghubungi kami. Saat ini di luar jam operasional, kami akan merespons pada jam kerja berikutnya.',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (inbox_id)
);

CREATE TABLE inbox_members (
    id BIGSERIAL PRIMARY KEY,
    inbox_id BIGINT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (inbox_id, user_id)
);

CREATE TABLE business_hours (
    id BIGSERIAL PRIMARY KEY,
    inbox_id BIGINT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    open_time TIME WITHOUT TIME ZONE NOT NULL DEFAULT '08:00:00',
    close_time TIME WITHOUT TIME ZONE NOT NULL DEFAULT '17:00:00',
    is_closed BOOLEAN DEFAULT FALSE,
    UNIQUE (inbox_id, day_of_week)
);

CREATE TABLE contacts (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone_number VARCHAR(255),
    avatar_url VARCHAR(1024),
    custom_attributes JSONB DEFAULT '{}'::jsonb,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    merged_into_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
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

CREATE TABLE contact_merge_logs (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    primary_contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    secondary_contact_id BIGINT NOT NULL,
    secondary_contact_data JSONB NOT NULL,
    merged_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversations_moved INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_contacts_deleted_at ON contacts(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_contact_merge_logs_account_id ON contact_merge_logs(account_id);
CREATE INDEX idx_contact_merge_logs_primary_contact_id ON contact_merge_logs(primary_contact_id);

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
    team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
    status conversation_status DEFAULT 'open',
    is_bot_active BOOLEAN DEFAULT TRUE,
    bot_state VARCHAR(255) DEFAULT 'start',
    snoozed_until TIMESTAMP WITH TIME ZONE,
    csat_survey_sent BOOLEAN DEFAULT FALSE,
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

CREATE TABLE label_team_routing (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    label_id BIGINT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    UNIQUE (label_id, team_id)
);

-- -------------------------------------------------------------------------
-- 7. Indexes for Performance (Important for high concurrency)
-- -------------------------------------------------------------------------
CREATE INDEX idx_conversations_account_id ON conversations(account_id);
CREATE INDEX idx_conversations_inbox_id ON conversations(inbox_id);
CREATE INDEX idx_conversations_contact_id ON conversations(contact_id);

CREATE INDEX idx_inbox_settings_inbox_id ON inbox_settings(inbox_id);
CREATE INDEX idx_inbox_settings_account_id ON inbox_settings(account_id);

CREATE INDEX idx_inbox_members_inbox_id ON inbox_members(inbox_id);
CREATE INDEX idx_inbox_members_user_id ON inbox_members(user_id);
CREATE INDEX idx_inbox_members_account_id ON inbox_members(account_id);

CREATE INDEX idx_business_hours_inbox_id ON business_hours(inbox_id);

CREATE INDEX idx_inboxes_account_id ON inboxes(account_id);
CREATE INDEX idx_tickets_conversation_id ON tickets(conversation_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_assignee_id ON tickets(assignee_id);
CREATE INDEX idx_tickets_team_id ON tickets(team_id);

CREATE INDEX idx_teams_account_id ON teams(account_id);
CREATE INDEX idx_team_members_team_id ON team_members(team_id);
CREATE INDEX idx_team_members_user_id ON team_members(user_id);
CREATE INDEX idx_label_team_routing_account_id ON label_team_routing(account_id);
CREATE INDEX idx_label_team_routing_label_id ON label_team_routing(label_id);
CREATE INDEX idx_label_team_routing_team_id ON label_team_routing(team_id);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_ticket_id ON messages(ticket_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_conversation_id_created_at ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_account_id_created_at ON messages(account_id, created_at);
CREATE INDEX idx_messages_wa_message_id ON messages(wa_message_id);

CREATE INDEX idx_contact_inboxes_source_id ON contact_inboxes(source_id);

CREATE INDEX idx_messages_ticket_sender_type ON messages(ticket_id, sender_type, created_at);
CREATE INDEX idx_tickets_resolved_at ON tickets(resolved_at) WHERE resolved_at IS NOT NULL;
CREATE INDEX idx_tickets_account_created ON tickets(account_id, created_at);


CREATE TABLE csat_ratings (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    assigned_agent_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (ticket_id)
);

CREATE INDEX idx_csat_ratings_ticket_id ON csat_ratings(ticket_id);
CREATE INDEX idx_csat_ratings_account_id ON csat_ratings(account_id);
CREATE INDEX idx_csat_ratings_assigned_agent_id ON csat_ratings(assigned_agent_id);

CREATE TABLE widget_sessions (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    inbox_id BIGINT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    fingerprint VARCHAR(64) NOT NULL,
    session_token VARCHAR(128) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    page_url TEXT,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_widget_sessions_token ON widget_sessions(session_token);
CREATE INDEX idx_widget_sessions_fingerprint ON widget_sessions(fingerprint, inbox_id);
CREATE INDEX idx_widget_sessions_contact_id ON widget_sessions(contact_id);
CREATE INDEX idx_widget_sessions_account_id ON widget_sessions(account_id);

CREATE TABLE chatbot_configs (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    inbox_id BIGINT REFERENCES inboxes(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL DEFAULT 'Default Bot',
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    editor_metadata JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT FALSE,
    version INTEGER DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chatbot_config_versions (
    id BIGSERIAL PRIMARY KEY,
    chatbot_config_id BIGINT NOT NULL REFERENCES chatbot_configs(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    config JSONB NOT NULL,
    editor_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (chatbot_config_id, version)
);

CREATE INDEX idx_chatbot_configs_account ON chatbot_configs(account_id);
CREATE INDEX idx_chatbot_configs_inbox ON chatbot_configs(inbox_id);
CREATE INDEX idx_chatbot_configs_active ON chatbot_configs(is_active) WHERE is_active = true;
CREATE INDEX idx_chatbot_versions_config ON chatbot_config_versions(chatbot_config_id);

CREATE TABLE webhooks (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    url VARCHAR(2048) NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}', 
    secret VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    description VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE webhook_delivery_logs (
    id BIGSERIAL PRIMARY KEY,
    webhook_id BIGINT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    attempt INTEGER DEFAULT 1,
    delivered_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webhooks_account_id ON webhooks(account_id);
CREATE INDEX idx_webhooks_active ON webhooks(active) WHERE active = true;
CREATE INDEX idx_webhook_delivery_logs_webhook_id ON webhook_delivery_logs(webhook_id);
CREATE INDEX idx_webhook_delivery_logs_created_at ON webhook_delivery_logs(created_at DESC);

CREATE TABLE ai_configs (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'openai',
    api_key_encrypted TEXT NOT NULL,
    model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
    max_tokens INT DEFAULT 500,
    temperature NUMERIC(2,1) DEFAULT 0.7,
    is_active BOOLEAN DEFAULT TRUE,
    features_enabled TEXT[] DEFAULT '{smart_reply,summarize,auto_categorize}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id)
);

CREATE TABLE ai_usage_logs (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    feature VARCHAR(50) NOT NULL,
    tokens_input INT NOT NULL DEFAULT 0,
    tokens_output INT NOT NULL DEFAULT 0,
    latency_ms INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_configs_account_id ON ai_configs(account_id);
CREATE INDEX idx_ai_configs_active ON ai_configs(is_active) WHERE is_active = true;
CREATE INDEX idx_ai_usage_logs_account_id ON ai_usage_logs(account_id);
CREATE INDEX idx_ai_usage_logs_created_at ON ai_usage_logs(created_at DESC);

-- -------------------------------------------------------------------------
-- 11. Automation Rules Engine
-- -------------------------------------------------------------------------
CREATE TABLE automation_rules (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    actions JSONB[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    priority INT DEFAULT 0,
    execution_count BIGINT DEFAULT 0,
    last_executed_at TIMESTAMP WITH TIME ZONE,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE automation_logs (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    rule_id BIGINT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
    ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_data JSONB,
    actions_executed JSONB[],
    actions_failed JSONB[],
    status VARCHAR(20) NOT NULL DEFAULT 'success',
    execution_time_ms INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_automation_rules_account_id ON automation_rules(account_id);
CREATE INDEX idx_automation_rules_active ON automation_rules(is_active) WHERE is_active = true;
CREATE INDEX idx_automation_rules_priority ON automation_rules(priority);
CREATE INDEX idx_automation_logs_account_id ON automation_logs(account_id);
CREATE INDEX idx_automation_logs_rule_id ON automation_logs(rule_id);
CREATE INDEX idx_automation_logs_created_at ON automation_logs(created_at DESC);

CREATE TYPE scheduled_message_status AS ENUM ('pending', 'sent', 'cancelled', 'failed');

CREATE TABLE scheduled_messages (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    media JSONB,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status scheduled_message_status DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    retry_count INT DEFAULT 0,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE email_message_metadata (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    email_message_id VARCHAR(255),
    in_reply_to VARCHAR(255),
    email_references TEXT,
    from_address VARCHAR(255) NOT NULL,
    to_addresses TEXT[] NOT NULL,
    cc_addresses TEXT[],
    bcc_addresses TEXT[],
    subject VARCHAR(500),
    html_content TEXT,
    has_attachments BOOLEAN DEFAULT FALSE,
    email_date TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX idx_email_meta_message_id ON email_message_metadata(message_id);
CREATE INDEX idx_email_meta_email_message_id ON email_message_metadata(email_message_id);
CREATE INDEX idx_email_meta_in_reply_to ON email_message_metadata(in_reply_to);

CREATE INDEX idx_scheduled_messages_pending ON scheduled_messages(scheduled_at) WHERE status = 'pending';

CREATE TABLE message_templates (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    variables TEXT[] NOT NULL DEFAULT '{}',
    category VARCHAR(100),
    language VARCHAR(10) DEFAULT 'id',
    is_active BOOLEAN DEFAULT TRUE,
    usage_count BIGINT DEFAULT 0,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, name)
);

CREATE INDEX idx_message_templates_search ON message_templates USING GIN(to_tsvector('indonesian', name || ' ' || body));

CREATE TYPE export_status AS ENUM ('queued', 'processing', 'completed', 'failed', 'expired');
CREATE TYPE export_format AS ENUM ('csv', 'xlsx');

CREATE TABLE export_jobs (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    export_type VARCHAR(50) NOT NULL,
    export_format export_format NOT NULL DEFAULT 'csv',
    filters JSONB DEFAULT '{}'::jsonb,
    status export_status DEFAULT 'queued',
    file_path VARCHAR(1024),
    file_size_bytes BIGINT,
    row_count INT,
    progress_percent INT DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE api_keys (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key_hash VARCHAR(64) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE
);
CREATE UNIQUE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

CREATE TABLE notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    data JSONB DEFAULT '{}'::jsonb,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_account_user ON notifications(account_id, user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
