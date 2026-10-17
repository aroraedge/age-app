// ============================================================
//  APP SETTINGS — the only file you edit to connect the app.
//  Leave SUPABASE_URL empty to run the app in DEMO MODE
//  (sample data saved only on this device).
// ============================================================
export const CONFIG = {
  COMPANY_NAME: "AGE",
  APP_NAME: "AGE",

  // From Supabase → Project Settings → API (or "Connect")
  SUPABASE_URL: "https://qovctplnmangzdsszgwv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Z90sfyXiUzKwvofgnzIJhA_DYmJ7s4M",   // the "anon" / "publishable" key — safe to be public

  // Public half of the push-notification key pair (safe to be public)
  VAPID_PUBLIC_KEY: "BPG7CkAxH5SRBF_NDexCoyNmAdzZCMfdvJt1ei3wqUkJijK_PTLnFWR_7dukXVg08rojj1qvvrbHGYcpv11VfBw",
};
