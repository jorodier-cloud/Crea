const STORAGE_KEY = 'crea.session';

/** Le jeton de session vit dans le navigateur ; l API l accepte en Bearer. */
export function getToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

/** Redirige vers la connexion si la session manque (appele cote client). */
export function requireSession(): boolean {
  if (isAuthenticated()) return true;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?next=${next}`;
  return false;
}
