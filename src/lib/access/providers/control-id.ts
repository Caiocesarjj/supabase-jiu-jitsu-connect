import type {
  AccessCredential,
  AccessEventPayload,
  AccessProvider,
  DeviceConfig,
  StudentSyncPayload,
} from "./types";

/**
 * Stub HTTP REST para equipamentos Control iD (iDFace, iDBlock, iDAccess).
 * A API oficial expõe endpoints como POST /login, POST /create_objects,
 * POST /modify_objects e POST /destroy_objects sob `http://{ip}:{port}/`.
 * Aqui apenas demarcamos a interface — a implementação real exige
 * gerenciar a `session` retornada pelo /login.
 */
export class ControlIdProvider implements AccessProvider {
  constructor(public readonly device: DeviceConfig) {}

  private baseUrl() {
    const ip = this.device.ipAddress ?? "";
    const port = this.device.port ?? 80;
    return `http://${ip}:${port}`;
  }

  async connect() {
    if (!this.device.ipAddress) return { ok: false, error: "IP não configurado" };
    try {
      const res = await fetch(`${this.baseUrl()}/login.fcgi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: "admin", password: this.device.apiToken ?? "" }),
      });
      return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "fetch failed" };
    }
  }

  async validateAccess(_credential: AccessCredential) {
    // O Control iD valida localmente — em geral apenas recebemos o evento.
    return { allowed: true };
  }

  async openGate() {
    try {
      const res = await fetch(`${this.baseUrl()}/execute_actions.fcgi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions: [{ action: "door", parameters: "door=1" }] }),
      });
      return { ok: res.ok };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "fetch failed" };
    }
  }

  async receiveEvent(payload: unknown): Promise<AccessEventPayload> {
    const p = (payload ?? {}) as Record<string, unknown>;
    return {
      studentExternalId: typeof p.user_id === "string" ? p.user_id : undefined,
      status: p.access === true ? "granted" : "denied",
      reason: typeof p.reason === "string" ? p.reason : undefined,
      rawPayload: payload,
    };
  }

  async syncUsers(_students: StudentSyncPayload[]) {
    // TODO: POST /create_objects.fcgi?object=users (em lote)
    return { ok: true };
  }

  async syncCredentials(_students: StudentSyncPayload[]) {
    // TODO: POST /create_objects.fcgi?object=cards / templates
    return { ok: true };
  }
}
