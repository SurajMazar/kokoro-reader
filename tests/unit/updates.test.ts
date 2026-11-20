import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, isNewer } from '@/shared/updates';

let storage: Record<string, unknown>;
let installType: string;

beforeEach(() => {
  storage = {};
  installType = 'development';
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '0.2.0' }) },
    management: { getSelf: async () => ({ installType }) },
    storage: {
      local: {
        get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
        set: async (items: Record<string, unknown>) => Object.assign(storage, items),
      },
    },
  });
});

const fetcher = (version: string) => vi.fn(async () => new Response(JSON.stringify({ version })));

describe('isNewer', () => {
  it('compares dotted versions numerically', () => {
    expect(isNewer('0.3.0', '0.2.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.2', '0.2.1')).toBe(false);
  });
});

describe('checkForUpdate', () => {
  it('makes no request for a Web Store install', async () => {
    installType = 'normal';
    const fetch = fetcher('9.9.9');
    expect(await checkForUpdate(true, fetch)).toMatchObject({ unpacked: false, available: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tells an unpacked install about a newer build, at most once a day unless forced', async () => {
    const fetch = fetcher('0.3.0');
    expect(await checkForUpdate(false, fetch)).toMatchObject({ unpacked: true, current: '0.2.0', latest: '0.3.0', available: true });
    await checkForUpdate(false, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    await checkForUpdate(true, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last known answer when offline', async () => {
    await checkForUpdate(true, fetcher('0.3.0'));
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await checkForUpdate(true, offline)).toMatchObject({ latest: '0.3.0', available: true });
  });
});
