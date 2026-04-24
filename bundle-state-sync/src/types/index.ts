// =============================================================================
// Query / pagination types
// =============================================================================

export type GetBundlesFilterParams = {
  intentOwner?: string;
  intentAuthority?: string;
  userId?: string;
  referralCode?: string;
  orderIds?: Array<string>;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export type PaginatedResponseMetadata = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type GetBundleListResponse = PaginatedResponseMetadata & {
  bundles: Array<BundleResponse>
}

// =============================================================================
// Enums
// =============================================================================

export enum TradingAlgorithm {
  MARKET = "market"
}

export enum TradeStatus {
  created = "created",
  partially_fulfilled = "partially_fulfilled",
  fulfilled = "fulfilled",
  cancelled = "cancelled",
  failed = "failed",
  expired = "expired",
}

export enum BundleStatus {
  created = "created",
  partially_fulfilled = "partially_fulfilled",
  fulfilled = "fulfilled",
  expired = "expired",
  cancelled = "cancelled",
  failed = "failed",
}

export const TERMINAL_BUNDLE_STATUSES: BundleStatus[] = [
  BundleStatus.fulfilled,
  BundleStatus.expired,
  BundleStatus.cancelled,
  BundleStatus.failed,
];

// =============================================================================
// API response types — aligned with GET /v1/gasless/bundles OpenAPI spec
// =============================================================================

export type CancelBundleData = {
  preImage: string;
  signature: string;
  authority: string;
  createdAt: string;
  reason?: string;
}

/** gasless-api_TradeTokenInDto */
export type TradeTokenIn = {
  chainId: number;
  address: string;
  amount: string;
  isWrapped?: boolean;
}

/** gasless-api_TradeTokenOutDto */
export type TradeTokenOut = {
  chainId: number;
  address: string;
  amount: string;
  minAmount: string;
}

/** gasless-api_ExternalCallDto */
export type ExternalCallResponse = {
  executionFee: string;
  fallbackAddressDst: string;
  data: string;
}

/** gasless-api_SubtradeResponseDto */
export type SubtradeResponse = {
  id: string;
  status: TradeStatus;
  tokenInAmount: string;
  tokenOutAmount: string;
  tokenOutMinAmount: string;
  createdAt: string;
  orderId?: string;
  transactionHash?: string;
}

/** gasless-api_GasPaymentBasicDetailsDto */
export type GasPaymentBasicDetails = {
  nativeTokenAmount: string;
  approximateUsdEquivalent: string;
}

/** gasless-api_TakenUserTokensDto */
export type TakenUserTokens = {
  tokenAddress: string;
  tokenAmount: string;
}

/** gasless-api_GasPaymentDto */
export type GasPaymentResponse = {
  type?: string;
  basicDetails?: GasPaymentBasicDetails;
  takenUserTokens?: TakenUserTokens[];
}

/** gasless-api_ActionDto */
export type ActionResponse = {
  type: number;
  actions: number[];
  signedData: string;
  data?: unknown;
  gasPayment?: GasPaymentResponse;
  actionId?: string;
}

/** gasless-api_BundleTradeResponseDto */
export type BundleTradeResponse = {
  id: string;
  intentId: string;
  tokenIn: TradeTokenIn;
  tokenOut: TradeTokenOut;
  receiverAddress: string;
  status: TradeStatus;
  executedSrc: boolean;
  executedDst: boolean;
  finalizedSrc: boolean;
  finalizedDst: boolean;
  subtrades: SubtradeResponse[];
  tradeId?: string;
  srcAuthorityAddress?: string;
  dstAuthorityAddress?: string;
  externalCall?: ExternalCallResponse;
  finalizedBlockSrc?: unknown;
  finalizedBlockDst?: unknown;
}

/** gasless-api_IntentWithActionsDto */
export type IntentWithActionsResponse = {
  intentId: string;
  requiredActions: ActionResponse[];
  intent: Record<string, unknown>;
}

/** gasless-api_HookDto */
export type HookResponse = {
  isAtomic: boolean;
  data: string;
  to: string;
  value: string;
  chainId: number;
  requiredActions: ActionResponse[];
  tokenAddress: string;
  from: string;
  executedSrc: boolean;
  executedDst: boolean;
  finalizedSrc: boolean;
  finalizedDst: boolean;
  finalizedBlockSrc?: unknown;
  finalizedBlockDst?: unknown;
}

/** gasless-api_BundleResponseDto */
export type BundleResponse = {
  // Required
  bundleId: string;
  status: BundleStatus;
  isAtomic: boolean;
  trades: BundleTradeResponse[];
  intents: IntentWithActionsResponse[];
  executedSrc: boolean;
  executedDst: boolean;
  finalizedSrc: boolean;
  finalizedDst: boolean;
  createdAt: string;

  // Optional
  referralCode?: string;
  tradingAlgorithm?: TradingAlgorithm;
  preHooks?: HookResponse[];
  postHooks?: HookResponse[];
  partnerCancelAuthority?: string[];
  cancel?: CancelBundleData;
  userId?: string;
  lockSrcTokenBalanceUpdate?: boolean;
  updatedAt?: string;
}

// =============================================================================
// WebSocket types — re-exported from ws.ts
// =============================================================================

export * from "./ws";
