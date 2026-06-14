import type {
  AccessCredential,
  AccessEventPayload,
  AccessProvider,
  DeviceConfig,
  StudentSyncPayload,
} from "./types";

/**
 * Stub para equipamentos TopData (Inner Rep, Inner Acesso).
 * A integração oficial costuma exigir o Conector TopData;
 * aqui ficamos com a camada HTTP equivalente.
 */
export class TopDataProvider implements AccessProvider {
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
