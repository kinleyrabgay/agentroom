import { AsyncLocalStorage } from 'node:async_hooks';
import type { RoomIdentity } from '../../shared/types/index.js';

/** Who a request or WebSocket message comes from: the owner (this machine) or a room member. */
export interface Principal extends RoomIdentity {
  kind: 'owner' | 'member';
}

const store = new AsyncLocalStorage<Principal>();

/** Run `fn` (and everything it starts) as `principal`, so audit entries name the right person. */
export function runAs<T>(principal: Principal, fn: () => T): T {
  return store.run(principal, fn);
}

export function currentPrincipal(): Principal | undefined {
  return store.getStore();
}

/** "Name <email>" of the room member behind the current request, or undefined for the owner. */
export function memberLabel(): string | undefined {
  const p = store.getStore();
  return p?.kind === 'member' ? `${p.name} <${p.email}>` : undefined;
}

/** "Name <email>" → { name, email }. */
export function parseUser(user: string): { name: string; email: string } {
  const m = /^(.*?)\s*<([^>]+)>$/.exec(user.trim());
  if (m) return { name: m[1]!.trim() || m[2]!, email: m[2]!.trim().toLowerCase() };
  return user.includes('@') ? { name: user, email: user.toLowerCase() } : { name: user || 'Owner', email: '' };
}
