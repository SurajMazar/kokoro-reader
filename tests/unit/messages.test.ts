import { describe, expect, it } from 'vitest';
import { targetOf } from '@/shared/messages/contract';
import { CONTENT_ALLOWED, isReadingDoc, isValidEnvelope } from '@/shared/messages/validate';
import { buildDoc } from '@/shared/text/doc';

const doc = buildDoc({ title: 'T', source: 'selection', blocks: [{ kind: 'paragraph', text: 'Hello there. General Kenobi.' }] });
const envelope = (type: string, payload: unknown, target = targetOf(type as never)) => ({ kr: 1, type, target, requestId: 'r1', payload });

describe('message validation', () => {
  it('accepts well-formed requests', () => {
    expect(isValidEnvelope(envelope('session/start', { doc }))).toBe(true);
    expect(isValidEnvelope(envelope('session/control', { action: 'seek', index: 3 }))).toBe(true);
    expect(isValidEnvelope(envelope('playback/state', { status: 'playing' }))).toBe(true);
  });
  it('rejects unknown types, bad payloads and foreign envelopes', () => {
    expect(isValidEnvelope(envelope('session/explode', {}))).toBe(false);
    expect(isValidEnvelope(envelope('session/control', { action: 'rm -rf' }))).toBe(false);
    expect(isValidEnvelope(envelope('session/control', { action: 'seek', index: 'x' }))).toBe(false);
    expect(isValidEnvelope({ ...envelope('session/state', {}), kr: 2 })).toBe(false);
    expect(isValidEnvelope({ type: 'session/state' })).toBe(false);
    expect(isValidEnvelope(null)).toBe(false);
  });
  it('rejects malformed or oversized documents', () => {
    expect(isReadingDoc(doc)).toBe(true);
    expect(isReadingDoc({ ...doc, source: 'evil' })).toBe(false);
    expect(isReadingDoc({ ...doc, sentences: [{ id: 'x' }] })).toBe(false);
    expect(isReadingDoc({ ...doc, blocks: [{ id: 0, text: 'x'.repeat(2_000_001) }] })).toBe(false);
  });
  it('routes types to the right context', () => {
    expect(targetOf('offscreen/load')).toBe('offscreen');
    expect(targetOf('offscreen/idle')).toBe('background');
    expect(targetOf('offscreen/diagnostic')).toBe('background');
    expect(targetOf('content/read')).toBe('content');
    expect(targetOf('playback/state')).toBe('broadcast');
    expect(targetOf('session/start')).toBe('background');
  });
  it('limits what pages may ask for', () => {
    expect(CONTENT_ALLOWED.has('session/start')).toBe(true);
    expect(CONTENT_ALLOWED.has('model/action')).toBe(false);
    expect(CONTENT_ALLOWED.has('export/wav')).toBe(false);
    expect(CONTENT_ALLOWED.has('history/resume')).toBe(false);
  });
});
