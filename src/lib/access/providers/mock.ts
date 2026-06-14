import type {
  AccessCredential,
  AccessEventPayload,
  AccessProvider,
  DeviceConfig,
  StudentSyncPayload,
} from "./types";

/**
 * Provider de fallback / operação manual via recepção.
 * Não se comunica com hardware — apenas registra a intenção.
 */
export class MockProvider implements AccessProvider {
  constructor(public readonly device: DeviceConfig) {}

  async connect() {
    return { ok: true };
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
