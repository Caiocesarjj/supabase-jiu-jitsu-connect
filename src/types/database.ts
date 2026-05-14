export type Belt =
  | "white"
  | "blue"
  | "purple"
  | "brown"
  | "black"
  | "gray"
  | "yellow"
  | "orange"
  | "green";

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
