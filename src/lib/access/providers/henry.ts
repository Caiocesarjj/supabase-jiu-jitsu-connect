import type {
  AccessCredential,
  AccessEventPayload,
  AccessProvider,
  DeviceConfig,
  StudentSyncPayload,
} from "./types";

/**
 * Stub para equipamentos Henry (linha Argos / Vega / Prisma).
 * Comunicação via TCP/IP é tipicamente feita por socket — aqui
 * deixamos os métodos preparados para um proxy HTTP intermediário.
 */
export class HenryProvider implements AccessProvider {
  constructor(public readonly device: DeviceConfig) {}

  async connect() {
    return { ok: !!this.device.ipAddress, error: this.device.ipAddress ? undefined : "IP não configurado" };
  }

  async validateAccess(_credential: AccessCredential) {
    return { allowed: true };
  }

  async openGate() {
    return { ok: true };
  }

  async receiveEvent(payload: unknown): Promise<AccessEventPayload> {
    return { rawPayload: payload };
  }

  async syncUsers(_students: StudentSyncPayload[]) {
    return { ok: true };
  }

  async syncCredentials(_students: StudentSyncPayload[]) {
    return { ok: true };
  }
}
