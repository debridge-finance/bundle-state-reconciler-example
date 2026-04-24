export enum BundleStatus {
  Created = "created",
  PartiallyFulfilled = "partially_fulfilled",
  Fulfilled = "fulfilled",
  Failed = "failed",
  Cancelled = "cancelled",
  Expired = "expired",
}

export interface BundleRow {
  bundle_id: string;
  status: BundleStatus;
  target_status: string;
  referral_code: string | null;
  cancel: unknown | null;
  created_at: Date;
  updated_at: Date;
}

export interface GetBundlesFilterParams {
  referralCode?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedBundlesResponse {
  bundles: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
