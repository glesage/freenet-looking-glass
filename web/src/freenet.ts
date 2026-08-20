// Connection layer. One WebSocket per tab, nothing else held open — every
// Freenet app shares the node's single origin and browsers cap per-origin
// connections (freenet-core#5213), so Looking Glass must never hold a second
// long-lived request.

import {
  ContractKey,
  FreenetWsApi,
  GetRequest,
  UpdateDataType,
  type GetResponse,
  type HostError,
  type ResponseHandler,
  type UpdateNotification,
} from "@freenetorg/freenet-stdlib";
import { queryNodeContracts } from "./node-query";

export type ConnStatus = "connecting" | "connected" | "disconnected";

export interface UpdateEvent {
  keyId: string;
  kind: "state" | "delta" | "state+delta";
  bytes: Uint8Array;
  receivedAt: number;
}

export type ContractEntry = { keyId: string; badge?: "subscribed" };
export type ContractListing = { entries: ContractEntry[]; error?: string };

function buildContractListing(subscribed: string[], hosted: string[]): ContractEntry[] {
  const seen = new Set<string>();
  const entries: ContractEntry[] = [];
  for (const keyId of subscribed) {
    if (seen.has(keyId)) continue;
    seen.add(keyId);
    entries.push({ keyId, badge: "subscribed" });
  }
  for (const keyId of hosted) {
    if (seen.has(keyId)) continue;
    seen.add(keyId);
    entries.push({ keyId });
  }
  return entries;
}

function nodeEndpoints(): { wsBase: string; nativeWsUrl: string } {
  const params = new URLSearchParams(location.search);
  const nodeHost = params.get("node") ?? location.host;
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsBase = `${wsProto}//${nodeHost}/v1/contract/command`;
  return { wsBase, nativeWsUrl: `${wsBase}?encodingProtocol=native` };
}

export class NodeClient {
  private api: FreenetWsApi | null = null;
  private statusCbs: Array<(s: ConnStatus, detail?: string) => void> = [];
  private updateCbs: Array<(u: UpdateEvent) => void> = [];
  private subscribeResultCbs: Array<(keyId: string, ok: boolean) => void> = [];
  private status: ConnStatus = "disconnected";

  connect(): void {
    if (this.api && this.status !== "disconnected") return;
    this.setStatus("connecting");

    const params = new URLSearchParams(location.search);
    const { wsBase } = nodeEndpoints();
    const authToken = params.get("authToken") ?? "";
    const wsUrl = new URL(wsBase);

    const handler: ResponseHandler = {
      onOpen: () => this.setStatus("connected"),
      onClose: (code, reason) =>
        this.setStatus("disconnected", `socket closed (${code}) ${reason ?? ""}`.trim()),
      onErr: (err: HostError) => {
        // Request-level errors surface through the rejected promises; this
        // callback also fires for them, so only log.
        console.warn("[looking-glass] host error:", err.cause);
      },
      onContractGet: () => {},
      onContractPut: () => {},
      onContractUpdate: () => {},
      onContractNotFound: () => {},
      onDelegateResponse: () => {},
      onContractUpdateNotification: (n: UpdateNotification) => {
        const ev = notificationToEvent(n);
        if (ev) for (const cb of this.updateCbs) cb(ev);
      },
      onSubscribeResponse: (key, subscribed) => {
        const keyId = key.encode();
        for (const cb of this.subscribeResultCbs) cb(keyId, subscribed);
      },
    };

    try {
      this.api = new FreenetWsApi(wsUrl, handler, authToken);
    } catch (e) {
      this.setStatus("disconnected", e instanceof Error ? e.message : String(e));
    }
  }

  async getState(keyId: string): Promise<Uint8Array> {
    const api = this.requireApi();
    const key = ContractKey.fromInstanceId(keyId);
    const response: GetResponse = await api.get(new GetRequest(key, false));
    return Uint8Array.from(response.state ?? []);
  }

  async subscribe(keyId: string): Promise<Uint8Array> {
    const api = this.requireApi();
    const key = ContractKey.fromInstanceId(keyId);
    // Standalone SubscribeRequest is fire-and-forget in stdlib and the node
    // often never answers with SubscribeResponse; fetch+subscribe is reliable.
    const response: GetResponse = await api.get(new GetRequest(key, false, true));
    for (const cb of this.subscribeResultCbs) cb(keyId, true);
    return Uint8Array.from(response.state ?? []);
  }

  async listContracts(): Promise<ContractListing> {
    try {
      const { nativeWsUrl } = nodeEndpoints();
      const { subscribed, hosted } = await queryNodeContracts(nativeWsUrl);
      return { entries: buildContractListing(subscribed, hosted) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[looking-glass] listContracts failed:", msg);
      return { entries: [], error: msg };
    }
  }

  onStatus(cb: (s: ConnStatus, detail?: string) => void): void {
    this.statusCbs.push(cb);
    cb(this.status);
  }

  onUpdate(cb: (u: UpdateEvent) => void): void {
    this.updateCbs.push(cb);
  }

  onSubscribeResult(cb: (keyId: string, ok: boolean) => void): void {
    this.subscribeResultCbs.push(cb);
  }

  private requireApi(): FreenetWsApi {
    if (!this.api || this.status !== "connected") {
      throw new Error("not connected to a Freenet node");
    }
    return this.api;
  }

  private setStatus(s: ConnStatus, detail?: string): void {
    this.status = s;
    for (const cb of this.statusCbs) cb(s, detail);
  }
}

export function notificationToEvent(n: UpdateNotification): UpdateEvent | null {
  const keyId = n.key?.encode?.() ?? "";
  const dataType = n.update?.updateDataType ?? UpdateDataType.NONE;
  const data = n.update?.updateData as
    | { state?: number[]; delta?: number[] }
    | null
    | undefined;

  if (!keyId) {
    console.warn("[looking-glass] dropped update notification: missing key", { dataType });
    return null;
  }
  if (!data) {
    console.warn("[looking-glass] dropped update notification:", keyId, { dataType, reason: "no updateData" });
    return null;
  }

  let kind: UpdateEvent["kind"];
  let bytes: Uint8Array;
  if (dataType === UpdateDataType.StateUpdate && data.state) {
    kind = "state";
    bytes = Uint8Array.from(data.state);
  } else if (dataType === UpdateDataType.DeltaUpdate && data.delta) {
    kind = "delta";
    bytes = Uint8Array.from(data.delta);
  } else if (dataType === UpdateDataType.StateAndDeltaUpdate && data.state) {
    kind = "state+delta";
    bytes = Uint8Array.from(data.state);
  } else if (dataType === UpdateDataType.StateAndDeltaUpdate && data.delta) {
    kind = "delta";
    bytes = Uint8Array.from(data.delta);
  } else {
    console.warn("[looking-glass] dropped update notification:", keyId, { dataType });
    return null;
  }
  return { keyId, kind, bytes, receivedAt: Date.now() };
}
