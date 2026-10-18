export type ExampleKind = "token" | "beam";

export interface PortalSession {
  access: boolean;
  role: "public" | "student" | "admin" | null;
  username: string | null;
  password_required: boolean;
}

export interface PortalExample<C = Record<string, unknown>> {
  id: number;
  kind: ExampleKind;
  name: string;
  note: string;
  config: C;
  version: number;
}

export class PortalError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new PortalError(data.detail || `Request failed (${response.status})`, response.status);
  return data as T;
}

export const getPortalSession = () => request<PortalSession>("/api/auth/session");
export const studentSignIn = (password: string) =>
  request<PortalSession>("/api/auth/student", { method: "POST", body: JSON.stringify({ password }) });
export const adminSignIn = (username: string, password: string) =>
  request<PortalSession>("/api/auth/admin", { method: "POST", body: JSON.stringify({ username, password }) });
export const signOut = () => request<{access: boolean}>("/api/auth/logout", { method: "POST", body: "{}" });
export const fetchExamples = <C,>(kind: ExampleKind) =>
  request<PortalExample<C>[]>(`/api/examples?kind=${kind}`);
export const addExample = <C,>(example: Omit<PortalExample<C>, "id" | "version">) =>
  request<PortalExample<C>>("/api/admin/examples", { method: "POST", body: JSON.stringify(example) });
export const saveExample = <C,>(example: PortalExample<C>) =>
  request<PortalExample<C>>(`/api/admin/examples/${example.id}`, { method: "PUT", body: JSON.stringify(example) });
export const removeExample = (id: number, version: number) =>
  request<{deleted: boolean}>(`/api/admin/examples/${id}?version=${version}`, { method: "DELETE" });
