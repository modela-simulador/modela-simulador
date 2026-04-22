/**
 * Shared authentication — same users/hashes as the Modela simulator.
 * Uses SHA-256 hashed passwords stored client-side (no backend).
 */

const AUTH_USERS: Record<string, { hash: string; name: string }> = {
  admin:  { hash: "be937117364594bbf4992371581edf109977e273694bc5fe07a1cfc6a11d99d1", name: "Administrador" },
  demo:   { hash: "2a97516c354b68848cdbd8f54a226a0a55b21ed138e207ad6c5cbb9c00aa5aea", name: "Demo" },
  modela: { hash: "1b7f61f34a609d26b1f7d60301ea2ff55dce19c69ef4c170744df54439ed1f3f", name: "Modela" },
};

const SESSION_SECRET = "mDl$2026!xK9";
const SESSION_KEY = "modela_token";
const USER_KEY = "modela_user";
const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function login(username: string, password: string): Promise<{ success: boolean; name?: string; error?: string }> {
  const user = username.trim().toLowerCase();
  const hash = await sha256(password);

  const entry = AUTH_USERS[user];
  if (!entry || entry.hash !== hash) {
    return { success: false, error: "Usuario o contrasena incorrectos" };
  }

  // Create signed session token (same format as simulator)
  const ts = Date.now();
  const sig = await sha256(user + ts + SESSION_SECRET);
  const token = btoa(JSON.stringify({ user, ts, sig }));

  sessionStorage.setItem(SESSION_KEY, token);
  sessionStorage.setItem(USER_KEY, entry.name);

  return { success: true, name: entry.name };
}

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  const token = sessionStorage.getItem(SESSION_KEY);
  if (!token) return false;
  try {
    const { user, ts } = JSON.parse(atob(token));
    if (!AUTH_USERS[user]) return false;
    if (Date.now() - ts > SESSION_DURATION) {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(USER_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getUsername(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(USER_KEY) || "";
}

export function logout(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(USER_KEY);
}
