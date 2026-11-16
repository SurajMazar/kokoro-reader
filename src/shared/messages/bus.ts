import { AppError, toErrorInfo } from '../errors';
import { createId } from '../utils/id';
import {
  targetOf,
  type Envelope,
  type EventMap,
  type EventType,
  type Reply,
  type RequestPayload,
  type RequestResponse,
  type RequestType,
  type Target,
} from './contract';
import { CONTENT_ALLOWED, isValidEnvelope } from './validate';

function envelope<T extends string, P>(type: T, payload: P, target: Target): Envelope<T, P> {
  return { kr: 1, type, target, requestId: createId(), payload };
}

function unwrap<T>(reply: Reply<T> | undefined, type: string): T {
  if (!reply) throw new AppError('E_BAD_MESSAGE', `No handler answered ${type}`);
  if (!reply.ok) throw new AppError(reply.error.code, reply.error.detail, reply.error.message);
  return reply.data;
}

/** Sends a request to the background or offscreen document and resolves with its typed response. */
export async function request<T extends RequestType>(type: T, payload: RequestPayload<T>): Promise<RequestResponse<T>> {
  const reply = (await chrome.runtime.sendMessage(envelope(type, payload, targetOf(type)))) as Reply<RequestResponse<T>> | undefined;
  return unwrap(reply, type);
}

/** Sends a request to the content script in a tab (top frame only). */
export async function requestTab<T extends RequestType>(tabId: number, type: T, payload: RequestPayload<T>): Promise<RequestResponse<T>> {
  const reply = (await chrome.tabs.sendMessage(tabId, envelope(type, payload, 'content'), { frameId: 0 })) as
    | Reply<RequestResponse<T>>
    | undefined;
  return unwrap(reply, type);
}

/** Fire-and-forget event to every extension context. Missing listeners are not an error. */
export function emit<T extends EventType>(type: T, payload: EventMap[T]): void {
  chrome.runtime.sendMessage(envelope(type, payload, targetOf(type))).catch(() => undefined);
}

export function emitToTab<T extends EventType>(tabId: number, type: T, payload: EventMap[T]): void {
  chrome.tabs.sendMessage(tabId, envelope(type, payload, 'content'), { frameId: 0 }).catch(() => undefined);
}

type RequestHandler<T extends RequestType> = (
  payload: RequestPayload<T>,
  sender: chrome.runtime.MessageSender,
) => RequestResponse<T> | Promise<RequestResponse<T>>;

type EventHandler<T extends EventType> = (payload: EventMap[T], sender: chrome.runtime.MessageSender) => void;

export type RequestHandlers = { [T in RequestType]?: RequestHandler<T> };
export type EventHandlers = { [T in EventType]?: EventHandler<T> };

export interface ListenOptions {
  /** Which envelope targets this context answers. */
  targets: Target[];
  requests?: RequestHandlers;
  events?: EventHandlers;
  /** Rejects messages from content scripts unless the type is allow-listed. */
  restrictContentScripts?: boolean;
}

/**
 * Registers a validated message listener. Messages from other extensions,
 * malformed envelopes and requests outside this context's targets are ignored.
 */
export function listen({ targets, requests = {}, events = {}, restrictContentScripts = false }: ListenOptions): () => void {
  const listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (reply: Reply<unknown>) => void) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (!isValidEnvelope(message)) return false;
    const accepts = targets.includes(message.target) || (message.target === 'broadcast' && targets.length > 0);
    if (!accepts) return false;

    const eventHandler = (events as Record<string, EventHandler<EventType> | undefined>)[message.type];
    if (eventHandler) {
      try {
        eventHandler(message.payload as never, sender);
      } catch (error) {
        console.error('[kokoro] event handler failed', message.type, error);
      }
      return false;
    }

    const handler = (requests as Record<string, RequestHandler<RequestType> | undefined>)[message.type];
    if (!handler) return false;
    const fromContentScript = Boolean(sender.tab) && !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`);
    if (restrictContentScripts && fromContentScript && !CONTENT_ALLOWED.has(message.type)) {
      sendResponse({ ok: false, error: new AppError('E_BAD_MESSAGE', `${message.type} is not allowed from pages`).toInfo() });
      return false;
    }
    Promise.resolve()
      .then(() => handler(message.payload as never, sender))
      .then(
        (data) => sendResponse({ ok: true, data: data ?? null }),
        (error: unknown) => sendResponse({ ok: false, error: toErrorInfo(error) }),
      );
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
