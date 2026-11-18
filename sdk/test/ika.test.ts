import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { IkaCurve, IkaScheme } from '../src/chains.js';
import { compactSignature, sdkCurve, sdkScheme } from '../src/ika/index.js';
import { findSignatureVoucherPda } from '../src/pda.js';

describe('ika helpers', () => {
  it('maps the on-chain curve and scheme numbers to the SDK', () => {
    expect(sdkCurve(IkaCurve.Secp256k1)).toBe('SECP256K1');
    expect(sdkCurve(IkaCurve.Curve25519)).toBe('ED25519');
    expect(() => sdkCurve(IkaCurve.Ristretto)).toThrow();
    expect(sdkScheme(IkaScheme.EcdsaKeccak256)).toEqual({ signatureAlgorithm: 'ECDSASecp256k1', hashScheme: 'KECCAK256' });
    expect(sdkScheme(IkaScheme.EddsaSha512)).toEqual({ signatureAlgorithm: 'EdDSA', hashScheme: 'SHA512' });
    expect(() => sdkScheme(1)).toThrow();
  });

  it('drops the recovery byte of an ECDSA signature only', () => {
    const ecdsa = new Uint8Array(65).fill(7);
    ecdsa[0] = 1;
    expect(compactSignature(IkaScheme.EcdsaKeccak256, ecdsa)).toEqual(new Uint8Array(64).fill(7));
    const compact = new Uint8Array(64).fill(9);
    expect(compactSignature(IkaScheme.EcdsaKeccak256, compact)).toBe(compact);
    const eddsa = new Uint8Array(64).fill(3);
    expect(compactSignature(IkaScheme.EddsaSha512, eddsa)).toBe(eddsa);
  });

  it('gives each leg of an intent its own voucher address', async () => {
    const program = address('DkXkmLYeR63gxhvD4FkV2oAJjkKzUUGJhDoqA6ULdauE');
    const intent = address('9ipcyfb7W434zuzCErmt6tBoDiYXFCkxdQ4ysMPbTmgF');
    const [leg0] = await findSignatureVoucherPda(program, intent, 0);
    const [leg1] = await findSignatureVoucherPda(program, intent, 1);
    // The voucher the devnet program accepted for intent #0, leg 0 of the current deployment.
    expect(leg0).toBe('3XGYh17932omxKnwJzGr3hLcUWoG1FeMoGYhs6xfr5Gi');
    expect(leg1).not.toBe(leg0);
  });
});
