-- ==============================================================================
-- DAWASNAP AI -> HARDENED SUPABASE POSTGRESQL BACKUP SCHEMA
-- Strictly Service-Role Key Only (Zero Anon / Authenticated Access)
-- Run this complete script in Supabase Dashboard -> SQL Editor -> Click Run
-- ==============================================================================

-- 1. Create Medicines Backup Table (Primary Key: id, Unique: user_id, id)
CREATE TABLE IF NOT EXISTS public.medicines (
    id VARCHAR(100) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100),
    form VARCHAR(50) DEFAULT 'other',
    expiration_date VARCHAR(50),
    quantity NUMERIC(10, 2) DEFAULT 0,
    total_quantity NUMERIC(10, 2) DEFAULT 0,
    category VARCHAR(255),
    categories TEXT[] DEFAULT ARRAY[]::TEXT[],
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    usage_instructions TEXT,
    price NUMERIC(10, 2),
    barcode VARCHAR(100),
    mfg_date VARCHAR(50),
    manufacturer VARCHAR(255),
    taken BOOLEAN DEFAULT FALSE,
    liked BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    batches JSONB,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT medicines_user_id_id_key UNIQUE (user_id, id)
);

-- Ensure UNIQUE constraint named medicines_user_id_id_key exists on (user_id, id)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'medicines') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conrelid = 'public.medicines'::regclass 
            AND conname = 'medicines_user_id_id_key'
        ) THEN
            BEGIN
                ALTER TABLE public.medicines ADD CONSTRAINT medicines_user_id_id_key UNIQUE (user_id, id);
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
        END IF;
    END IF;
END $$;

-- Indexes for high-performance querying & analytics
CREATE INDEX IF NOT EXISTS idx_medicines_user_id ON public.medicines(user_id);
CREATE INDEX IF NOT EXISTS idx_medicines_name ON public.medicines(name);
CREATE INDEX IF NOT EXISTS idx_medicines_expiration ON public.medicines(expiration_date);
CREATE INDEX IF NOT EXISTS idx_medicines_is_deleted ON public.medicines(is_deleted);
CREATE INDEX IF NOT EXISTS idx_medicines_form ON public.medicines(form);

-- 2. Create User Configs Backup Table
CREATE TABLE IF NOT EXISTS public.user_configs (
    user_id VARCHAR(128) PRIMARY KEY,
    email VARCHAR(255),
    email_notifications_enabled BOOLEAN DEFAULT FALSE,
    browser_notifications_enabled BOOLEAN DEFAULT FALSE,
    alert_threshold INTEGER DEFAULT 30,
    accent_color VARCHAR(16) DEFAULT '#0f9d58',
    sort_order VARCHAR(32) DEFAULT 'default',
    low_quantity_threshold INTEGER DEFAULT 5,
    theme VARCHAR(32) DEFAULT 'system',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create User Push Tokens Backup Table
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
    id VARCHAR(150) NOT NULL,
    user_id VARCHAR(128) NOT NULL,
    token TEXT NOT NULL,
    platform VARCHAR(32) DEFAULT 'android',
    app_version VARCHAR(32),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.user_push_tokens(user_id);

-- 4. Create Users Table (Synced from Firebase Auth Admin)
CREATE TABLE IF NOT EXISTS public.users (
    user_id TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    photo_url TEXT,
    phone_number TEXT,
    email_verified BOOLEAN DEFAULT FALSE,
    disabled BOOLEAN DEFAULT FALSE,
    provider_ids TEXT[],
    last_sign_in_time TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration helper if table was previously created with old schema
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'uid') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_id') THEN
            ALTER TABLE public.users RENAME COLUMN uid TO user_id;
        END IF;
        ALTER TABLE public.users DROP COLUMN IF EXISTS provider_data;
        ALTER TABLE public.users ADD COLUMN IF NOT EXISTS provider_ids TEXT[];
        ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_sign_in_time TIMESTAMPTZ;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- 5. Create Medicine Audit History Table
CREATE TABLE IF NOT EXISTS public.medicine_history (
    id TEXT PRIMARY KEY,
    medicine_id TEXT NOT NULL,
    user_id TEXT,
    action TEXT,
    details TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration helper if table was previously created without created_at
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'medicine_history') THEN
        ALTER TABLE public.medicine_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_medicine_history_user ON public.medicine_history(user_id);
CREATE INDEX IF NOT EXISTS idx_medicine_history_med ON public.medicine_history(medicine_id);

-- 6. Create Persistent Sync State Table
CREATE TABLE IF NOT EXISTS public.sync_state (
    key VARCHAR(100) PRIMARY KEY,
    last_sync_time BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Drop legacy open policies that allowed anon / authenticated access
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Allow anon full access to medicines" ON public.medicines;
    DROP POLICY IF EXISTS "Allow anon full access to user_configs" ON public.user_configs;
    DROP POLICY IF EXISTS "Allow anon full access to user_push_tokens" ON public.user_push_tokens;
    DROP POLICY IF EXISTS "Allow anon full access to users" ON public.users;
    DROP POLICY IF EXISTS "Allow anon full access to medicine_history" ON public.medicine_history;
    DROP POLICY IF EXISTS "Allow anon full access to sync_state" ON public.sync_state;
END $$;

-- 8. Enable Row Level Security (RLS) with ZERO anon/authenticated policies
-- Server exclusively uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;

-- 9. Explicitly REVOKE ALL permissions from anon and authenticated roles
REVOKE ALL ON TABLE public.medicines FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_configs FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_push_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.medicine_history FROM anon, authenticated;
REVOKE ALL ON TABLE public.sync_state FROM anon, authenticated;

-- 10. Helper View for Active Medicines Analytics WITH (security_invoker = true)
CREATE OR REPLACE VIEW public.vw_active_medicines WITH (security_invoker = true) AS
SELECT 
    id,
    user_id,
    name,
    dosage,
    form,
    quantity,
    expiration_date,
    category,
    price,
    updated_at
FROM public.medicines
WHERE is_deleted = FALSE;

REVOKE ALL ON public.vw_active_medicines FROM anon, authenticated;
