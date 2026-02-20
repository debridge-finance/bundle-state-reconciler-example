import { BundleResponse } from "./index";

// =============================================================================
// WebSocket types — copied from gasless-intents-examples/src/gasless-intents/web-sockets/types.ts
// =============================================================================

/** Individual filter keys accepted by the WS API. */
export enum WsFilterKey {
  bundleId = "bundleId",
  referralCode = "referralCode",
  intentOwner = "intentOwner",
  intentAuthority = "intentAuthority",
  cancelPartnerAuthority = "cancelPartnerAuthority",
  userId = "userId"
}

/** Map of filter keys to their value types. */
export type WsFilterMap = {
  bundleId?: string[];                // UUIDs designated by the API upon bundle submission
  referralCode?: string[];            // usually a single string, but sent as array
  intentOwner?: string[];             // addresses
  intentAuthority?: string[];         // addresses
  cancelPartnerAuthority?: string[];  // addresses
  userId?: string[];                  // UUID app-level identifiers
};

/**
 * The filter object the client sends.
 */
export type WsFilterWrapper = {
  filters: WsFilterMap;
};


/** The array shape returned by buildFilters(). */
export type BuiltFilters = WsFilterWrapper[];


// ---- Client → Server messages ---------------------------------------------

export enum ClientEvent {
  subscribe = "subscribe",
  unsubscribe = "unsubscribe"
}
/** Base envelope for messages sent to the server. */
export interface ClientEnvelope<TEvent extends ClientEvent, TData> {
  event: TEvent;
  data: TData;
}

/** Subscribe with a specific filter wrapper. */
export type SubscribeMessage = ClientEnvelope<ClientEvent.subscribe, WsFilterWrapper>;

/** Unsubscribe mirrors subscribe (same filter used to subscribe). */
export type UnsubscribeMessage = ClientEnvelope<ClientEvent.unsubscribe, WsFilterWrapper>;

/** Union of all client-sent messages. */
export type ClientMessage = SubscribeMessage | UnsubscribeMessage;

// ---- Server → Client messages ---------------------------------------------

export enum ServerEvent {
  subscribe = "subscribe",
  bundle_update = "bundle_update",
  unsubscribed = "unsubscribed",
  error = "error"
}

/** Generic server envelope; `data` shape depends on `event`. */
export interface ServerEnvelope<TEvent extends ServerEvent = ServerEvent, TData = unknown> {
  event: TEvent;
  data: TData;
}

/** Echo/summary returned after a successful subscription. */
export interface SubscribeAckData {
  /** The filters the server accepted; may include normalization. */
  filters?: WsFilterMap;
  /** Optional server-assigned subscription identifier (if implemented). */
  subscriptionId?: string;
}

/** Echo/summary returned after unsubscribe. */
export interface UnsubscribedData {
  filters?: WsFilterMap;
  subscriptionId?: string;
}

/** Error payload sent by the server. */
export interface ServerErrorData {
  code?: string | number;
  message: string;
  details?: unknown;
}

/** Discriminated unions for server messages. */
export type SubscribeAckMessage = ServerEnvelope<ServerEvent.subscribe, SubscribeAckData>;
export type BundleUpdateMessage = ServerEnvelope<ServerEvent.bundle_update, BundleResponse>;
export type UnsubscribedMessage = ServerEnvelope<ServerEvent.unsubscribed, UnsubscribedData>;
export type ServerErrorMessage = ServerEnvelope<ServerEvent.error, ServerErrorData>;

/** Union of all server-received messages handled in the switch-case. */
export type ServerMessage =
  | SubscribeAckMessage
  | BundleUpdateMessage
  | UnsubscribedMessage
  | ServerErrorMessage;

/** DeBridgeWsClient constructor argument. */
export type WSConfig = {
  url: string;
  filters: WsFilterMap;
  reconnect?: {
    enabled: boolean;
    baseMs: number;
    maxMs: number;
  }
}

// ---- Narrow helpers / type guards -----------------------------------------

export function isServerEnvelope(x: unknown): x is ServerMessage {
  return (
    typeof x === "object" &&
    x !== null &&
    "event" in x &&
    typeof (x as any).event === "string" &&
    "data" in x
  );
}

export function isBundleUpdate(m: ServerMessage): m is BundleUpdateMessage {
  return m.event === ServerEvent.bundle_update;
}

export function isServerError(m: ServerMessage): m is ServerErrorMessage {
  return m.event === ServerEvent.error;
}

// =============================================================================
// Extended WS types for bundle-state-sync workers
// =============================================================================

/** Extended config for the WS client used by Worker 1. */
export type WSClientConfig = WSConfig & {
  /** Called when a bundle update arrives. */
  onBundleUpdate: (bundle: BundleResponse) => void | Promise<void>;
  /** Called on connection errors. */
  onError?: (error: Error) => void;
  /** Called when connection is established. */
  onOpen?: () => void;
  /** Called when connection is closed. */
  onClose?: (code: number, reason: string) => void;
  /** Ping/pong keep-alive interval in ms (0 = disabled). */
  pingIntervalMs?: number;
  /** Max subscriptions per single WS connection. */
  maxSubscriptionsPerConnection?: number;
};

/** Statistics from the subscription manager. */
export interface SubscriptionManagerStats {
  activeSubscriptions: number;
  totalConnections: number;
  bundleIdsTracked: number;
}

/** Manages WS subscriptions across potentially multiple connections. */
export interface SubscriptionManager {
  /** Subscribe to updates for a set of bundle IDs. */
  subscribe(bundleIds: string[]): Promise<void>;
  /** Unsubscribe from updates for a set of bundle IDs. */
  unsubscribe(bundleIds: string[]): Promise<void>;
  /** Subscribe to a batch of bundle IDs, splitting across connections if needed. */
  subscribeBatch(bundleIds: string[]): Promise<void>;
  /** Remove subscriptions for bundles that have reached a terminal status. */
  pruneTerminal(terminalBundleIds: string[]): Promise<void>;
  /** Get current subscription statistics. */
  getStats(): SubscriptionManagerStats;
  /** Close all connections and clean up. */
  close(): Promise<void>;
}

// ---- buildFilters helper --------------------------------------------------

/**
 * Wraps a WsFilterMap into the BuiltFilters array shape expected by the subscribe message.
 */
export function buildFilters(map: WsFilterMap): BuiltFilters {
  return [{ filters: map }];
}
