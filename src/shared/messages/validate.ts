import type { ReadingDoc } from '../types';
import type { Envelope, EventType, RequestType } from './contract';

type Check = (value: unknown) => boolean;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString: Check = (value) => typeof value === 'string';
const isNumber: Check = (value) => typeof value === 'number' && Number.isFinite(value);
const isBoolean: Check = (value) => typeof value === 'boolean';
const optional = (check: Check): Check => (value) => value === undefined || value === null || check(value);
const oneOf = (...values: string[]): Check => (value) => typeof value === 'string' && values.includes(value);

function shape(spec: Record<string, Check>): Check {
  return (value) => isObject(value) && Object.entries(spec).every(([key, check]) => check(value[key]));
}

const MAX_DOC_CHARS = 2_000_000;
const MAX_BLOCKS = 20_000;

export function isReadingDoc(value: unknown): value is ReadingDoc {
  if (!isObject(value)) return false;
  if (!isString(value.id) || !isString(value.title) || !oneOf('selection', 'page', 'article', 'custom', 'queue')(value.source)) return false;
  const { blocks, sentences } = value;
  if (!Array.isArray(blocks) || !Array.isArray(sentences) || blocks.length > MAX_BLOCKS) return false;
  let chars = 0;
  for (const block of blocks) {
    if (!isObject(block) || !isNumber(block.id) || !isString(block.text)) return false;
    chars += (block.text as string).length;
  }
  if (chars > MAX_DOC_CHARS) return false;
  return sentences.every(
    (sentence) =>
      isObject(sentence) && isNumber(sentence.id) && isNumber(sentence.blockId) && isNumber(sentence.start) && isNumber(sentence.end) && isString(sentence.text),
  );
}

const controlAction = oneOf('play', 'pause', 'toggle', 'stop', 'next', 'previous', 'next-block', 'previous-block', 'seek', 'restart');
const modelAction = oneOf('download', 'pause', 'cancel', 'clear', 'validate', 'initialize', 'unload');
const readMode = oneOf('selection', 'page', 'from-selection', 'article');

const REQUEST_VALIDATORS: Record<RequestType, Check> = {
  'session/start': shape({ doc: isReadingDoc, tabId: optional(isNumber), startSentence: optional(isNumber), enqueue: optional(isBoolean) }),
  'session/control': shape({ action: controlAction, index: optional(isNumber) }),
  'session/set': shape({ rate: optional(isNumber), volume: optional(isNumber), voice: optional(isString) }),
  'session/state': isObject,
  'session/play-queue': shape({ itemId: optional(isString) }),
  'tab/read': shape({ tabId: isNumber, mode: readMode, startSentence: optional(isNumber) }),
  'tab/info': shape({ tabId: isNumber }),
  'tab/extract': shape({ tabId: isNumber, mode: oneOf('article', 'page') }),
  'reader/open': shape({ tabId: optional(isNumber), mode: optional(oneOf('article', 'custom')) }),
  'model/state': isObject,
  'model/action': shape({ action: modelAction, variantId: optional(isString) }),
  'voices/list': isObject,
  'voices/preview': shape({ voice: isString, engine: optional(oneOf('kokoro', 'browser')), text: optional(isString) }),
  'export/wav': shape({ doc: isReadingDoc, voice: optional(isString), speed: optional(isNumber) }),
  'permissions/sync': isObject,
  'ui/open-options': shape({ section: optional(isString) }),
  'session/doc': isObject,
  'bookmark/add': shape({ name: optional(isString) }),
  'history/resume': shape({ id: isString }),
  'offscreen/load': shape({ sessionId: isString, doc: isReadingDoc, startSentence: isNumber, config: isObject }),
  'offscreen/control': shape({ sessionId: optional(isString), action: controlAction, index: optional(isNumber) }),
  'offscreen/set': shape({ rate: optional(isNumber), volume: optional(isNumber), voice: optional(isString), config: optional(isObject) }),
  'offscreen/model': shape({ action: modelAction, variantId: isString, backend: oneOf('auto', 'webgpu', 'wasm') }),
  'offscreen/model-state': shape({ variantId: isString }),
  'offscreen/preview': shape({ voice: isString, engine: oneOf('kokoro', 'browser'), text: isString, config: isObject }),
  'offscreen/export': shape({ doc: isReadingDoc, voice: isString, speed: isNumber, config: isObject }),
  'offscreen/browser-voices': isObject,
  'offscreen/parse-article': shape({ snapshot: shape({ html: isString, url: isString, title: isString, language: isString }) }),
  'offscreen/ping': isObject,
  'content/read': shape({ mode: readMode, startSentence: optional(isNumber) }),
  'content/snapshot': isObject,
  'content/info': isObject,
  'content/ping': isObject,
};

const EVENT_VALIDATORS: Record<EventType, Check> = {
  'playback/state': isObject,
  'model/state': isObject,
  'session/ended': shape({ sessionId: isString, completed: isBoolean }),
  'offscreen/idle': shape({ idleMs: isNumber }),
  'offscreen/diagnostic': shape({ kind: isString, data: isObject }),
  'content/session': shape({ state: isObject, ownsSession: isBoolean }),
  'content/highlight': shape({ sessionId: isString, sentenceId: optional(isNumber), blockId: optional(isNumber) }),
  'content/clear': shape({ sessionId: optional(isString) }),
  'content/model': isObject,
};

/** Request types a content script (running inside an untrusted page) may send. */
export const CONTENT_ALLOWED: ReadonlySet<string> = new Set<RequestType>([
  'session/start',
  'session/control',
  'session/set',
  'session/state',
  'reader/open',
  'model/state',
  'voices/list',
  'ui/open-options',
]);

export function isRequestType(type: string): type is RequestType {
  return type in REQUEST_VALIDATORS;
}

export function isEventType(type: string): type is EventType {
  return type in EVENT_VALIDATORS;
}

/** Returns true when the value is a well-formed envelope whose payload matches its type. */
export function isValidEnvelope(value: unknown): value is Envelope {
  if (!isObject(value) || value.kr !== 1 || !isString(value.type) || !isString(value.requestId)) return false;
  if (!oneOf('background', 'offscreen', 'content', 'broadcast')(value.target)) return false;
  const type = value.type as string;
  const validator = isRequestType(type) ? REQUEST_VALIDATORS[type] : isEventType(type) ? EVENT_VALIDATORS[type] : null;
  return validator !== null && validator(value.payload ?? {});
}
