import type { User } from "@supabase/supabase-js";

/**
 * Notary role as exposed by Supabase Auth.
 * Accepts `role` in user_metadata or app_metadata depending on config / hooks.
 */
function coerceRole(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  return undefined;
}

export function getAuthNotaryRole(user: User | null): string | undefined {
  if (!user) return undefined;
  const fromUser = coerceRole(user.user_metadata?.role);
  const fromApp = coerceRole(user.app_metadata?.role);
  const raw = fromUser || fromApp;
  return raw?.toLowerCase();
}

export function isNotaryUser(user: User | null): boolean {
  return getAuthNotaryRole(user) === "notary";
}
