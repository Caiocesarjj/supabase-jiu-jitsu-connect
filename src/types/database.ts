export type Belt =
  // Trilha adulto
  | "branca"
  | "azul"
  | "roxa"
  | "marrom"
  | "preta"
  // Faixa preta avançada
  | "coral"
  | "vermelha"
  // Trilha infantil — sem friso
  | "cinza"
  | "amarela"
  | "laranja"
  | "verde"
  // Trilha infantil — friso branco
  | "cinza_branco"
  | "amarela_branco"
  | "laranja_branco"
  | "verde_branco"
  // Trilha infantil — friso preto
  | "cinza_preto"
  | "amarela_preto"
  | "laranja_preto"
  | "verde_preto";

export interface Graduation {
  id: string;
  organization_id: string;
  student_id: string;
  belt: Belt;
  degrees: number; // 0–4 nas faixas coloridas, 1–10 na faixa preta
  promotion_date: string;
  minimum_next_promotion_date: string | null;
  classes_since_promotion: number;
  updated_by: string | null;
  updated_at: string;
}

export interface GraduationHistory {
  id: string;
  organization_id: string;
  student_id: string;
  new_belt: Belt;
  new_degrees: number;
  promoted_at: string;
  promoted_by: string | null;
  notes: string | null;
}

export type StudentStatus = "active" | "inactive" | "trial";

export type FinancialStatus = "pending" | "paid" | "overdue" | "canceled";

export type UserRole = "admin" | "instructor" | "staff";

export type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  email: string;
  phone: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  organization_id: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface OrganizationSettings {
  organization_id: string;
  monthly_fee_default: number;
  due_day: number;
  pix_key: string | null;
  pix_key_type: PixKeyType | null;
  whatsapp_enabled: boolean;
  notify_d_minus_3: boolean;
  notify_d_zero: boolean;
  notify_d_plus_3: boolean;
}

export interface Student {
  id: string;
  organization_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  belt: Belt;
  stripes: number;
  status: StudentStatus;
  monthly_fee: number | null;
  enrolled_at: string;
  notes: string | null;
}

export interface ClassEntity {
  id: string;
  organization_id: string;
  name: string;
  weekday: number;
  start_time: string;
  end_time: string;
  instructor_id: string | null;
}

export interface Attendance {
  id: string;
  organization_id: string;
  class_id: string;
  student_id: string;
  attended_at: string;
}

export interface FinancialRecord {
  id: string;
  organization_id: string;
  student_id: string;
  amount: number;
  reference_month: string;
  due_date: string;
  paid_at: string | null;
  status: FinancialStatus;
  pix_code: string | null;
  invoice_url: string | null;
  idempotency_key: string;
}
