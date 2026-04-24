import WebSocket from "ws";

const MAX_SUBS_PER_CONNECTION = 100;

// bundleId → Set of WebSocket clients subscribed to it
const bundleSubscribers = new Map<string, Set<WebSocket>>();

// WebSocket client → Set of bundleIds they're subscribed to
const clientSubscriptions = new Map<WebSocket, Set<string>>();

export function addClient(ws: WebSocket): void {
  clientSubscriptions.set(ws, new Set());
}

export function removeClient(ws: WebSocket): void {
  const subs = clientSubscriptions.get(ws);
  if (subs) {
    for (const bundleId of subs) {
      const subscribers = bundleSubscribers.get(bundleId);
      if (subscribers) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          bundleSubscribers.delete(bundleId);
        }
      }
    }
  }
  clientSubscriptions.delete(ws);
}

export function subscribe(
  ws: WebSocket,
  bundleIds: string[],
): { accepted: string[]; rejected: string[]; total: number } {
  const subs = clientSubscriptions.get(ws);
  if (!subs) {
    return { accepted: [], rejected: bundleIds, total: 0 };
  }

  // Replace semantics: clear all existing subscriptions before adding new ones
  for (const existingId of subs) {
    const subscribers = bundleSubscribers.get(existingId);
    if (subscribers) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        bundleSubscribers.delete(existingId);
      }
    }
  }
  subs.clear();

  const accepted: string[] = [];
  const rejected: string[] = [];

  for (const bundleId of bundleIds) {
    if (subs.has(bundleId)) {
      // Already subscribed — count as accepted, no-op
      accepted.push(bundleId);
      continue;
    }

    if (subs.size >= MAX_SUBS_PER_CONNECTION) {
      rejected.push(bundleId);
      continue;
    }

    subs.add(bundleId);

    let subscribers = bundleSubscribers.get(bundleId);
    if (!subscribers) {
      subscribers = new Set();
      bundleSubscribers.set(bundleId, subscribers);
    }
    subscribers.add(ws);

    accepted.push(bundleId);
  }

  return { accepted, rejected, total: subs.size };
}

export function unsubscribe(
  ws: WebSocket,
  bundleIds: string[],
): { removed: string[]; total: number } {
  const subs = clientSubscriptions.get(ws);
  if (!subs) {
    return { removed: [], total: 0 };
  }

  const removed: string[] = [];

  for (const bundleId of bundleIds) {
    if (!subs.has(bundleId)) continue;

    subs.delete(bundleId);
    removed.push(bundleId);

    const subscribers = bundleSubscribers.get(bundleId);
    if (subscribers) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        bundleSubscribers.delete(bundleId);
      }
    }
  }

  return { removed, total: subs.size };
}

export function getSubscribers(bundleId: string): Set<WebSocket> | undefined {
  return bundleSubscribers.get(bundleId);
}

export function getStats(): { totalClients: number; totalSubscriptions: number } {
  let totalSubscriptions = 0;
  for (const subs of clientSubscriptions.values()) {
    totalSubscriptions += subs.size;
  }
  return { totalClients: clientSubscriptions.size, totalSubscriptions };
}
