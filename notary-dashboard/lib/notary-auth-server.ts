import type { User } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase";
import { isNotaryUser } from "@/lib/notary-role";

/**
 * Verifies notary role using Auth DB when the session JWT is incomplete or stale
 * (metadata updated after login).
 */
export async function isNotaryUserWithAuthLookup(user: User): Promise<boolean> {
  if (isNotaryUser(user)) return true;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.auth.admin.getUserById(user.id);
    if (error) {
      console.error("[notary-auth] admin.getUserById:", error.message);
      return false;
    }
    if (!data?.user) return false;
    return isNotaryUser(data.user);
  } catch (e) {
    console.error("[notary-auth] admin.getUserById failed:", e);
    return false;
  }
}
