const API_BASE = process.env.API_BASE || 'http://localhost:4000/api';
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

async function postJson<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

async function getJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface Account {
  id: string;
  name: string;
  currentBalance: string | number;
}

export async function apiGetAccount(token: string, id: string): Promise<Account> {
  return getJson(`/treasury/accounts/${id}`, token);
}

export async function apiPinLogin(): Promise<string> {
  const data = await postJson<{ accessToken: string }>('/auth/pin-login', { pin: ADMIN_PIN });
  return data.accessToken;
}

export interface VehicleInput {
  plate: string;
  stage?: 'NEGOCIANDO' | 'COMPRADO' | 'ALISTAMIENTO' | 'PUBLICADO' | 'DISPONIBLE' | 'VENDIDO';
  brand?: string;
  model?: string;
  year?: number;
  negotiatedValue?: number;
  purchasePrice?: number;
  listedPrice?: number;
  supplierId?: string;
  participation?: number;
}

export async function apiCreateVehicle(token: string, data: VehicleInput): Promise<{ id: string; plate: string }> {
  return postJson('/vehicles', data, token);
}
