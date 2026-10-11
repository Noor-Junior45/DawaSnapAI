-- ==============================================================================
-- DAWASNAP AI -> SUPABASE POSTGRESQL BACKUP SCHEMA
-- Run this complete script in the Supabase Dashboard -> SQL Editor -> Click Run
-- ==============================================================================

-- 1. Create Medicines Backup Table
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
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for lightning fast queries & analytics
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
    id VARCHAR(150) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    token TEXT NOT NULL,
    platform VARCHAR(32) DEFAULT 'android',
    app_version VARCHAR(32),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.user_push_tokens(user_id);

-- 4. Enable Row Level Security (RLS) & Grant Access for API Key
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

-- Allow anon and authenticated roles to read and write backup data
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Allow anon full access to medicines" ON public.medicines;
    CREATE POLICY "Allow anon full access to medicines" ON public.medicines
        FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow anon full access to user_configs" ON public.user_configs;
    CREATE POLICY "Allow anon full access to user_configs" ON public.user_configs
        FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow anon full access to user_push_tokens" ON public.user_push_tokens;
    CREATE POLICY "Allow anon full access to user_push_tokens" ON public.user_push_tokens
        FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

-- 5. Helper View for Expiring Medicines Analytics
CREATE OR REPLACE VIEW public.vw_active_medicines AS
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
