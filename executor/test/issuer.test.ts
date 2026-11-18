import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadIkaIssuer, saveIkaIssuer, type IkaIssuerSecrets } from '../src/config.js';

describe('issuer secrets', () => {
  afterEach(() => {
    delete process.env.LEDGER_IKA_ISSUER_FILE;
    delete process.env.LEDGER_IKA_ISSUER;
  });

  it('round-trips byte arrays through the file and the env var', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ika-issuer-')), 'ika-issuer.json');
    process.env.LEDGER_IKA_ISSUER_FILE = file;
    expect(loadIkaIssuer()).toBeNull();
    const secrets = {
      rootSeed: new Uint8Array(32).fill(5),
      dwallets: { secp256k1: { curve: 0, publicKey: new Uint8Array([2, 3, 4]), attestation: { attestation_data: new Uint8Array([9]) } } },
    } as unknown as IkaIssuerSecrets;
    saveIkaIssuer(secrets);
    expect(loadIkaIssuer()).toEqual(secrets);

    // The env var holds the file's content and wins over the file.
    process.env.LEDGER_IKA_ISSUER = JSON.stringify({ rootSeed: { $hex: '07'.repeat(32) }, dwallets: {} });
    expect(loadIkaIssuer()).toEqual({ rootSeed: new Uint8Array(32).fill(7), dwallets: {} });
  });

  it('refuses secrets without a 32-byte root seed', () => {
    process.env.LEDGER_IKA_ISSUER = JSON.stringify({ rootSeed: { $hex: '0102' }, dwallets: {} });
    expect(() => loadIkaIssuer()).toThrow(/root seed/);
  });
});
