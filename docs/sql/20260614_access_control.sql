-- ============================================================
-- Módulo de Recepção e Controle de Acesso
-- Rode este SQL no Lovable Cloud → SQL Editor.
-- ============================================================

-- ---------- Credenciais de acesso por aluno ----------
CREATE TABLE IF NOT EXISTS public.student_access_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  access_code text NOT NULL,
  pin_code text NOT NULL,
  qr_code text NOT NULL,
  rfid_uid text,
  biometric_id text,
  face_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id),
  UNIQUE (organization_id, access_code),
  UNIQUE (organization_id, qr_code)
);

CREATE INDEX IF NOT EXISTS student_access_credentials_org_idx
  ON public.student_access_credentials (organization_id);
CREATE INDEX IF NOT EXISTS student_access_credentials_rfid_idx
  ON public.student_access_credentials (organization_id, rfid_uid)
  WHERE rfid_uid IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_access_credentials TO authenticated;
GRANT ALL ON public.student_access_credentials TO service_role;

ALTER TABLE public.student_access_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sac_select" ON public.student_access_credentials;
CREATE POLICY "sac_select" ON public.student_access_credentials FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "sac_insert" ON public.student_access_credentials;
CREATE POLICY "sac_insert" ON public.student_access_credentials FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "sac_update" ON public.student_access_credentials;
CREATE POLICY "sac_update" ON public.student_access_credentials FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "sac_delete" ON public.student_access_credentials;
CREATE POLICY "sac_delete" ON public.student_access_credentials FOR DELETE TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- ---------- Dispositivos de acesso (catracas / leitores) ----------
CREATE TABLE IF NOT EXISTS public.access_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  manufacturer text NOT NULL CHECK (manufacturer IN ('control_id','henry','topdata','mock','other')),
  model text,
  ip_address text,
  port integer,
  api_token text,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_devices_org_idx ON public.access_devices (organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_devices TO authenticated;
GRANT ALL ON public.access_devices TO service_role;

ALTER TABLE public.access_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_select" ON public.access_devices;
CREATE POLICY "ad_select" ON public.access_devices FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "ad_insert" ON public.access_devices;
CREATE POLICY "ad_insert" ON public.access_devices FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "ad_update" ON public.access_devices;
CREATE POLICY "ad_update" ON public.access_devices FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "ad_delete" ON public.access_devices;
CREATE POLICY "ad_delete" ON public.access_devices FOR DELETE TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- ---------- Registros de presença (catraca / recepção) ----------
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  access_method text NOT NULL CHECK (access_method IN ('manual','code','pin','qr','rfid','biometric','face','gate')),
  checkin_at timestamptz NOT NULL DEFAULT now(),
  device_id uuid REFERENCES public.access_devices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_records_org_idx
  ON public.attendance_records (organization_id, checkin_at DESC);
CREATE INDEX IF NOT EXISTS attendance_records_student_idx
  ON public.attendance_records (student_id, checkin_at DESC);

GRANT SELECT, INSERT ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_records TO service_role;

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ar_select" ON public.attendance_records;
CREATE POLICY "ar_select" ON public.attendance_records FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "ar_insert" ON public.attendance_records;
CREATE POLICY "ar_insert" ON public.attendance_records FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- ---------- Log de todas as tentativas de acesso ----------
CREATE TABLE IF NOT EXISTS public.access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  device_id uuid REFERENCES public.access_devices(id) ON DELETE SET NULL,
  access_method text NOT NULL,
  status text NOT NULL CHECK (status IN ('granted','denied')),
  reason text,
  raw_input text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_logs_org_idx
  ON public.access_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS access_logs_student_idx
  ON public.access_logs (student_id, created_at DESC);

GRANT SELECT, INSERT ON public.access_logs TO authenticated;
GRANT ALL ON public.access_logs TO service_role;

ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "al_select" ON public.access_logs;
CREATE POLICY "al_select" ON public.access_logs FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "al_insert" ON public.access_logs;
CREATE POLICY "al_insert" ON public.access_logs FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- ---------- Perfis faciais (estrutura preparada — sem ML local) ----------
CREATE TABLE IF NOT EXISTS public.student_face_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  face_reference text,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sfp_org_idx ON public.student_face_profiles (organization_id);
CREATE INDEX IF NOT EXISTS sfp_student_idx ON public.student_face_profiles (student_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_face_profiles TO authenticated;
GRANT ALL ON public.student_face_profiles TO service_role;

ALTER TABLE public.student_face_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sfp_select" ON public.student_face_profiles;
CREATE POLICY "sfp_select" ON public.student_face_profiles FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "sfp_insert" ON public.student_face_profiles;
CREATE POLICY "sfp_insert" ON public.student_face_profiles FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "sfp_update" ON public.student_face_profiles;
CREATE POLICY "sfp_update" ON public.student_face_profiles FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

NOTIFY pgrst, 'reload schema';
