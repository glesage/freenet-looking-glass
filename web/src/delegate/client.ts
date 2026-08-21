import type { DelegateResponse } from "@freenetorg/freenet-stdlib";
import type { NodeClient } from "../freenet";
import {
  parseWatchlist,
  serializeWatchlist,
  type WatchlistEntry,
} from "../watchlist";
import { deriveDelegateIdentity, type DelegateIdentity } from "./keys";
import { decodeResponse, encodeGet, encodeSet, Status, type DecodedResponse } from "./wire";
import wasmUrl from "./watchlist_delegate.wasm?url";

const REQUEST_TIMEOUT_MS = 10_000;
const SET_DEBOUNCE_MS = 300;

interface Pending {
  resolve: (value: DecodedResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** `undefined` = init failed; `null` = fresh namespace (never stored); else stored list. */
export type WatchlistBoot = WatchlistEntry[] | null | undefined;

export class WatchlistDelegate {
  private identity: DelegateIdentity | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private setTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSet: WatchlistEntry[] | null = null;

  constructor(private readonly client: NodeClient) {
    client.onDelegateResponse((response) => this.handleResponse(response));
  }

  async init(): Promise<WatchlistBoot> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.runSetup();
      } catch {
        // full register+read retry once
      }
    }
    return undefined;
  }

  set(list: WatchlistEntry[]): void {
    if (!this.identity) return;
    this.pendingSet = list;
    if (this.setTimer !== null) clearTimeout(this.setTimer);
    this.setTimer = setTimeout(() => {
      this.setTimer = null;
      const toWrite = this.pendingSet;
      this.pendingSet = null;
      if (toWrite) void this.flushSet(toWrite);
    }, SET_DEBOUNCE_MS);
  }

  private async runSetup(): Promise<WatchlistEntry[] | null> {
    const resp = await fetch(wasmUrl);
    if (!resp.ok) throw new Error("wasm fetch failed");
    const wasm = new Uint8Array(await resp.arrayBuffer());
    this.identity = deriveDelegateIdentity(wasm);
    await this.sendRegister(Array.from(wasm));
    return this.readStoredWatchlist();
  }

  private async readStoredWatchlist(): Promise<WatchlistEntry[] | null> {
    const response = await this.send(encodeGet(this.allocId()));
    if (response.status === Status.NotFound) return null;
    if (response.status !== Status.Ok) {
      throw new Error(`watchlist get failed: ${response.status}`);
    }
    return parseWatchlist(response.blob);
  }

  private async flushSet(list: WatchlistEntry[]): Promise<boolean> {
    try {
      const response = await this.send(encodeSet(this.allocId(), serializeWatchlist(list)));
      return response.status === Status.Ok;
    } catch {
      return false;
    }
  }

  private identityBytes(): { keyBytes: number[]; codeHashBytes: number[] } {
    if (!this.identity) throw new Error("delegate not initialized");
    return {
      keyBytes: Array.from(this.identity.key),
      codeHashBytes: Array.from(this.identity.codeHash),
    };
  }

  private allocId(): number {
    const id = this.nextId;
    this.nextId = (this.nextId + 1) >>> 0;
    return id;
  }

  private send(payload: Uint8Array): Promise<DecodedResponse> {
    if (!this.identity) return Promise.reject(new Error("delegate not initialized"));
    return new Promise((resolve, reject) => {
      const id = new DataView(payload.buffer, payload.byteOffset + 1, 4).getUint32(0, true);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("delegate request timed out"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      void this.sendApplicationMessage(Array.from(payload)).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private handleResponse(response: DelegateResponse): void {
    if (!response.values?.length) return;
    for (const outbound of response.values) {
      if (outbound.inboundType !== 1) continue;
      const msg = outbound.inbound as { payload?: number[] } | null;
      if (!msg?.payload?.length) continue;
      const decoded = decodeResponse(new Uint8Array(msg.payload));
      if (!decoded) continue;
      const pending = this.pending.get(decoded.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(decoded.id);
      pending.resolve(decoded);
    }
  }

  private async sendRegister(wasmBytes: number[]): Promise<void> {
    const { keyBytes, codeHashBytes } = this.identityBytes();
    const req = await this.buildRegisterRequest(wasmBytes, keyBytes, codeHashBytes);
    this.client.sendDelegateRequest(req);
  }

  private async sendApplicationMessage(payload: number[]): Promise<void> {
    const { keyBytes, codeHashBytes } = this.identityBytes();
    const req = await this.buildApplicationMessagesRequest(payload, keyBytes, codeHashBytes);
    this.client.sendDelegateRequest(req);
  }

  private async buildRegisterRequest(
    wasmBytes: number[],
    keyBytes: number[],
    codeHashBytes: number[],
  ): Promise<unknown> {
    const {
      ClientRequestT,
      ClientRequestType,
      DelegateCodeT,
      DelegateContainerT,
      DelegateKeyT,
      DelegateRequestT,
      DelegateRequestType,
      DelegateType,
      RegisterDelegateT,
      WasmDelegateV1T,
    } = await import("@freenetorg/freenet-stdlib/client-request");

    const cipher = new Array<number>(32).fill(0);
    const nonce = new Array<number>(24).fill(0);
    const delegateCode = new DelegateCodeT(wasmBytes, codeHashBytes);
    const delegateKey = new DelegateKeyT(keyBytes, codeHashBytes);
    const wasmDelegate = new WasmDelegateV1T([], delegateCode, delegateKey);
    const container = new DelegateContainerT(DelegateType.WasmDelegateV1, wasmDelegate);
    const register = new RegisterDelegateT(container, cipher, nonce);
    const delegateReq = new DelegateRequestT(DelegateRequestType.RegisterDelegate, register);
    return new ClientRequestT(ClientRequestType.DelegateRequest, delegateReq);
  }

  private async buildApplicationMessagesRequest(
    payload: number[],
    keyBytes: number[],
    codeHashBytes: number[],
  ): Promise<unknown> {
    const { ApplicationMessageT } = await import("@freenetorg/freenet-stdlib/common");
    const {
      ApplicationMessagesT,
      ClientRequestT,
      ClientRequestType,
      DelegateKeyT,
      DelegateRequestT,
      DelegateRequestType,
      InboundDelegateMsgT,
      InboundDelegateMsgType,
    } = await import("@freenetorg/freenet-stdlib/client-request");

    const appMsg = new ApplicationMessageT(payload, [], false);
    const inbound = new InboundDelegateMsgT(
      InboundDelegateMsgType.common_ApplicationMessage,
      appMsg,
    );
    const delegateKey = new DelegateKeyT(keyBytes, codeHashBytes);
    const appMessages = new ApplicationMessagesT(delegateKey, [], [inbound]);
    const delegateReq = new DelegateRequestT(DelegateRequestType.ApplicationMessages, appMessages);
    return new ClientRequestT(ClientRequestType.DelegateRequest, delegateReq);
  }
}
