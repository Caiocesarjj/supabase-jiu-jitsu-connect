/**
 * Camada de abstração para dispositivos de controle de acesso.
 * Implementações concretas (Control iD, Henry, TopData) ficam em
 * arquivos vizinhos e seguem este contrato. Nenhum SDK proprietário
 * é importado — apenas chamadas HTTP REST.
 */

export type AccessMethod =
  | "manual"
  | "code"
  | "pin"
  | "qr"
  | "rfid"
  | "biometric"
  | "face"
  | "gate";

export interface AccessCredential {
  method: AccessMethod;
  value: string;
}

export interface AccessEventPayload {
  studentExternalId?: string;
  credential?: AccessCredential;
  status?: "granted" | "denied";
  reason?: string;
  rawPayload?: unknown;
}

export interface DeviceConfig {
  id: string;
  manufacturer: "control_id" | "henry" | "topdata" | "mock" | "other";
  name: string;
  ipAddress: string | null;
  port: number | null;
  apiToken: string | null;
}

export interface StudentSyncPayload {
  externalId: string;
  name: string;
  accessCode: string;
  rfidUid: string | null;
  biometricId: string | null;
  faceId: string | null;
  active: boolean;
}

export interface AccessProvider {
  readonly device: DeviceConfig;
  connect(): Promise<{ ok: boolean; error?: string }>;
  validateAccess(credential: AccessCredential): Promise<{ allowed: boolean; reason?: string }>;
  openGate(): Promise<{ ok: boolean; error?: string }>;
  receiveEvent(payload: unknown): Promise<AccessEventPayload>;
  syncUsers(students: StudentSyncPayload[]): Promise<{ ok: boolean; error?: string }>;
  syncCredentials(students: StudentSyncPayload[]): Promise<{ ok: boolean; error?: string }>;
}
