import { GetBundlesFilterParams, GetBundleListResponse, BundleResponse } from "../types";

export interface DebridgeApiOptions {
  baseUrl: string;
  apiKey: string;
}

/**
 * Fetch a paginated list of bundles matching the given filters.
 */
export async function fetchBundles(
  options: DebridgeApiOptions,
  filters: GetBundlesFilterParams
): Promise<GetBundleListResponse> {
  const url = new URL("/v1/gasless/bundles", options.baseUrl);

  for (const [key, value] of Object.entries(filters)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        url.searchParams.append(key, String(v));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": options.apiKey,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `deBridge API error: GET ${url.pathname}${url.search} → ${res.status} ${res.statusText}: ${body}`
    );
  }

  return (await res.json()) as GetBundleListResponse;
}

/**
 * Fetch a single bundle by ID. Returns `null` if 404.
 */
export async function fetchBundleById(
  options: DebridgeApiOptions,
  bundleId: string
): Promise<BundleResponse | null> {
  const url = new URL(`/v1/gasless/bundles/${encodeURIComponent(bundleId)}`, options.baseUrl);

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": options.apiKey,
      "Accept": "application/json",
    },
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `deBridge API error: GET ${url.pathname} → ${res.status} ${res.statusText}: ${body}`
    );
  }

  return (await res.json()) as BundleResponse;
}
