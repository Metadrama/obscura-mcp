export interface SessionData {
  id: string;
  targetId: string;
  sessionId: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
}

export interface EventListener {
  sessionId?: string;
  filter?: (params: unknown) => boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
}

export interface WaitForEventOptions {
  sessionId?: string;
  filter?: (params: unknown) => boolean;
  timeoutMs?: number;
}

export interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  sessionId?: string;
  error?: CdpError;
  result?: unknown;
}

export interface CdpError {
  message: string;
  code?: number;
  data?: unknown;
}

export interface ToolContent {
  type: string;
  text: string;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  url?: string;
}
