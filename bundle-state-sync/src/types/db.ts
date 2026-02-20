import { BundleResponse } from "./index";

export type ApiBundleResponse = BundleResponse;

export type BundleRow = {
  bundle_id: string;
  status: string;
  has_cancellation: boolean;
  raw_payload: Record<string, unknown>;
  check_count: number;
  requires_manual_review: boolean;
  flagged_at: Date | null;
  last_checked_at: Date | null;
  first_seen_source: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  synced_at: Date;
};

export type Stats = {
  byStatus: Record<string, number>;
  flagged: number;
  inFlight: number;
  total: number;
};
