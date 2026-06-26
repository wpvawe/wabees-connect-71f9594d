-- Phase 2.5: source tracking + firebase uid index
ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_firebase_uid_unique
  ON public.profiles(firebase_uid)
  WHERE firebase_uid IS NOT NULL;
