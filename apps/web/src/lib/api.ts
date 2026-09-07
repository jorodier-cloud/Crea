import type { PageTree, SitePage, TreeOperation } from '@crea/schema';

import { clearToken, getToken } from './session.js';

export const API_URL =
  (import.meta.env.PUBLIC_API_URL as string | undefined)?.replace(/\/+$/, '') ??
  'http://localhost:8787';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; details?: unknown } }
    | null;

  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw new ApiClientError(
      response.status,
      payload?.error?.code ?? 'unknown',
      payload?.error?.message ?? `Erreur ${response.status}`,
      payload?.error?.details,
    );
  }

  return payload as T;
}

/* -------------------------------------------------------------------------- */
/* Types de reponse                                                           */
/* -------------------------------------------------------------------------- */

export interface PublicUser {
  id: string;
  email: string;
  iaPointsBalance: number;
  createdAt: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  /** Adresse publique du site, `null` tant qu il n a jamais ete publie. */
  slug: string | null;
  /** Horodatage de la derniere mise en ligne, `null` si hors ligne. */
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Project extends ProjectSummary {
  pages: SitePage[];
}

export interface PublishResult {
  project: Project;
  publicUrl: string | null;
}

export interface Media {
  id: string;
  originalName: string;
  key: string;
  url: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: number;
}

export interface AiPromptResult {
  message: string;
  tree: PageTree;
  operations: TreeOperation[];
  applied: number;
  errors: string[];
  saved: boolean;
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  points: { spent: number; balance: number; overdrawn: boolean };
}

export interface PaymentSettings {
  configured: boolean;
  publicKey: string | null;
}

export interface Order {
  id: string;
  productName: string;
  unitAmount: number;
  currency: string;
  customerEmail: string | null;
  customerName: string | null;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  createdAt: number;
  paidAt: number | null;
}

interface PresignResult {
  mode: 'worker' | 's3';
  key: string;
  uploadUrl: string;
  method: 'PUT';
  publicUrl: string;
  expiresIn: number;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

export const api = {
  requestMagicLink: (email: string) =>
    request<{ ok: true; expiresAt: number; devLink?: string; devToken?: string }>(
      '/api/auth/magic-link',
      { method: 'POST', body: JSON.stringify({ email }) },
    ),

  verifyMagicLink: (token: string) =>
    request<{ token: string; user: PublicUser }>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  me: () => request<{ user: PublicUser }>('/api/auth/me'),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  listProjects: () => request<{ projects: ProjectSummary[] }>('/api/projects'),

  createProject: (title: string) =>
    request<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  getProject: (id: string) =>
    request<{ project: Project; publicUrl: string | null }>(`/api/projects/${id}`),

  publishProject: (id: string, slug?: string) =>
    request<PublishResult>(`/api/projects/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify(slug ? { slug } : {}),
    }),

  unpublishProject: (id: string) =>
    request<PublishResult>(`/api/projects/${id}/unpublish`, { method: 'POST' }),

  saveProject: (id: string, input: { title?: string; pages?: SitePage[] }) =>
    request<{ project: Project; issues: string[] }>(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteProject: (id: string) =>
    request<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),

  getPaymentSettings: (projectId: string) =>
    request<{ settings: PaymentSettings; webhookUrl: string }>(`/api/projects/${projectId}/payments`),

  savePaymentSettings: (
    projectId: string,
    input: { publicKey: string; secretKey: string; webhookSecret: string },
  ) =>
    request<{ settings: PaymentSettings }>(`/api/projects/${projectId}/payments`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  disconnectPayments: (projectId: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/payments`, { method: 'DELETE' }),

  listOrders: (projectId: string) => request<{ orders: Order[] }>(`/api/projects/${projectId}/orders`),

  listMedias: () => request<{ medias: Media[] }>('/api/media'),

  deleteMedia: (id: string) => request<{ ok: true }>(`/api/media/${id}`, { method: 'DELETE' }),

  aiPrompt: (input: {
    projectId: string;
    pageId: string;
    prompt: string;
    tree: PageTree;
    selectedNodeId?: string | null;
  }) =>
    request<AiPromptResult>('/api/ai/prompt', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /**
   * Upload en deux temps : le navigateur pousse le fichier vers R2 (URL
   * presignee), puis l API enregistre la ligne en D1. Le Worker ne relaie
   * jamais les octets, sauf en mode developpement (`mode: "worker"`).
   */
  async uploadMedia(file: File): Promise<Media> {
    const presigned = await request<PresignResult>('/api/media/presigned-url', {
      method: 'POST',
      body: JSON.stringify({
        originalName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      }),
    });

    const uploadUrl =
      presigned.mode === 'worker' ? `${API_URL}${presigned.uploadUrl}` : presigned.uploadUrl;

    const headers = new Headers({ 'Content-Type': file.type });
    if (presigned.mode === 'worker') {
      const token = getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }

    const upload = await fetch(uploadUrl, { method: 'PUT', headers, body: file });
    if (!upload.ok) {
      throw new ApiClientError(upload.status, 'upload_failed', 'Envoi du fichier impossible.');
    }

    const { media } = await request<{ media: Media }>('/api/media/sync', {
      method: 'POST',
      body: JSON.stringify({ key: presigned.key, originalName: file.name }),
    });
    return media;
  },
};
