/** Background ⇄ offscreen ⇄ content messaging through the real bus on a simulated chrome.runtime. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChromeMock } from '../chrome-mock';
import { buildDoc } from '@/shared/text/doc';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function contextWith(chromeGlobal: typeof chrome) {
  vi.stubGlobal('chrome', chromeGlobal);
  vi.resetModules();
  return import('@/shared/messages/bus');
}

describe('message bus', () => {
  it('routes typed requests to the right context and returns typed replies', async () => {
    const mock = createChromeMock();
    const offscreen = await contextWith(mock.contextChrome({ url: 'chrome-extension://test-extension-id/offscreen/index.html' }));
    offscreen.listen({ targets: ['offscreen'], requests: { 'offscreen/ping': () => ({ alive: true, sessionId: 's1' }) } });
    const background = await contextWith(mock.contextChrome({ url: 'chrome-extension://test-extension-id/background.js' }));
    background.listen({ targets: ['background'], requests: { 'session/state': () => ({ status: 'idle' }) as never } });
    const popup = await contextWith(mock.contextChrome({ url: 'chrome-extension://test-extension-id/popup/index.html' }));
    expect(await popup.request('offscreen/ping', {})).toEqual({ alive: true, sessionId: 's1' });
    expect(await popup.request('session/state', {})).toEqual({ status: 'idle' });
  });

  it('propagates handler errors as AppErrors with their code', async () => {
    const mock = createChromeMock();
    const background = await contextWith(mock.contextChrome());
    const { AppError } = await import('@/shared/errors');
    background.listen({
      targets: ['background'],
      requests: {
        'session/start': () => {
          throw new AppError('E_EMPTY_TEXT');
        },
      },
    });
    const popup = await contextWith(mock.contextChrome({ url: 'chrome-extension://test-extension-id/popup/index.html' }));
    const doc = buildDoc({ title: 't', source: 'custom', blocks: [{ kind: 'paragraph', text: 'Hi there.' }] });
    await expect(popup.request('session/start', { doc })).rejects.toMatchObject({ code: 'E_EMPTY_TEXT' });
  });

  it('blocks privileged requests from content scripts but allows reading', async () => {
    const mock = createChromeMock();
    const background = await contextWith(mock.contextChrome());
    const exportHandler = vi.fn(() => ({ url: 'x', filename: 'f', durationSeconds: 1, bytes: 1 }));
    background.listen({
      targets: ['background'],
      restrictContentScripts: true,
      requests: { 'export/wav': exportHandler, 'session/state': () => ({ status: 'idle' }) as never },
    });
    const content = await contextWith(mock.contextChrome({ tab: { id: 7 } as chrome.tabs.Tab, url: 'https://evil.example/' }));
    const doc = buildDoc({ title: 't', source: 'custom', blocks: [{ kind: 'paragraph', text: 'Hi there.' }] });
    await expect(content.request('export/wav', { doc })).rejects.toMatchObject({ code: 'E_BAD_MESSAGE' });
    expect(exportHandler).not.toHaveBeenCalled();
    expect(await content.request('session/state', {})).toEqual({ status: 'idle' });
  });

  it('ignores malformed messages and messages from other extensions', async () => {
    const mock = createChromeMock();
    const background = await contextWith(mock.contextChrome());
    const handler = vi.fn(() => null);
    background.listen({ targets: ['background'], requests: { 'session/control': handler } });
    const other = mock.contextChrome({ id: 'another-extension' });
    vi.stubGlobal('chrome', other);
    expect(await other.runtime.sendMessage({ kr: 1, type: 'session/control', target: 'background', requestId: 'x', payload: { action: 'stop' } })).toBeUndefined();
    const same = mock.contextChrome();
    expect(await same.runtime.sendMessage({ kr: 1, type: 'session/control', target: 'background', requestId: 'x', payload: { action: 'explode' } })).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });
});
