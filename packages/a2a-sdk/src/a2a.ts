// ─── A2A Protocol Types ───────────────────────────────────────────────────────
// Based on https://google.github.io/A2A

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled';

export type PartType = 'text' | 'data' | 'file';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface DataPart {
  type: 'data';
  data: Record<string, unknown>;
  mimeType?: string;
}

export interface FilePart {
  type: 'file';
  mimeType: string;
  data?: string;       // base64 encoded
  uri?: string;
}

export type Part = TextPart | DataPart | FilePart;

export interface Message {
  role: 'user' | 'agent';
  parts: Part[];
  messageId?: string;
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp: string;
}

export interface Task {
  id: string;
  contextId?: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentAuthentication {
  schemes: string[];
  credentials?: string;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  documentationUrl?: string;
  capabilities: AgentCapabilities;
  authentication: AgentAuthentication;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
}

// ─── Request / Response shapes ────────────────────────────────────────────────

export interface SendTaskRequest {
  id: string;
  skill?: string;
  message: Message;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface SendTaskResponse {
  id: string;
  result?: Task;
  error?: A2AError;
}

export interface GetTaskRequest {
  id: string;
  historyLength?: number;
}

export interface GetTaskResponse {
  id: string;
  result?: Task;
  error?: A2AError;
}

export interface SendTaskMessageRequest {
  id: string;
  message: Message;
  metadata?: Record<string, unknown>;
}

export interface SendTaskMessageResponse {
  id: string;
  result?: Task;
  error?: A2AError;
}

export interface A2AError {
  code: number;
  message: string;
  data?: unknown;
}
