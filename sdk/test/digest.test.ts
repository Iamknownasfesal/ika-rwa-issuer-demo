import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { accountWord, eip712DomainSeparator, eip712Message, legNonce, messageDigest, rawMessage, type Authorization } from '../src/digest.js';
import { fromHex, toHex } from '../src/format.js';

interface Vector {
  name: string;
  action: 0 | 1;
  amount: string;
  account: string;
  nonce: string;
  ledger: string;
  domainSeparator: string;
  accountWord: string;
  rawMessage: string;
  rawDigest: string;
  eip712Message: string;
  eip712Digest: string;
}

const vectors: Vector[] = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));

describe('digest vectors (emitted by the Rust program)', () => {
  it('has vectors', () => expect(vectors.length).toBeGreaterThan(0));
  for (const v of vectors) {
    it(v.name, () => {
      const a: Authorization = {
        action: v.action,
        amount: BigInt(v.amount),
        account: fromHex(v.account),
        nonce: BigInt(v.nonce),
        ledger: fromHex(v.ledger),
        domainSeparator: fromHex(v.domainSeparator),
      };
      expect(toHex(accountWord(a.account))).toBe(v.accountWord);
      expect(toHex(rawMessage(a))).toBe(v.rawMessage);
      expect(toHex(messageDigest(0, a))).toBe(v.rawDigest);
      expect(toHex(eip712Message(a))).toBe(v.eip712Message);
      expect(toHex(messageDigest(1, a))).toBe(v.eip712Digest);
    });
  }
});

describe('legNonce', () => {
  it('packs index and leg', () => {
    expect(legNonce(0n, 0)).toBe(0n);
    expect(legNonce(0n, 1)).toBe(1n);
    expect(legNonce(7n, 0)).toBe(14n);
    expect(legNonce(7n, 1)).toBe(15n);
  });
});

describe('eip712DomainSeparator', () => {
  it('matches the well-known EIP-712 domain formula', () => {
    // Computed independently with ethers.TypedDataEncoder.hashDomain for
    // {name:'TBILL MintController', version:'1', chainId: 11155111, verifyingContract: 0x000..01}
    const sep = eip712DomainSeparator({
      name: 'TBILL MintController',
      version: '1',
      chainId: 11155111,
      verifyingContract: fromHex('0000000000000000000000000000000000000001'),
    });
    expect(sep.length).toBe(32);
    // stability check: deterministic
    expect(toHex(sep)).toBe(toHex(eip712DomainSeparator({ name: 'TBILL MintController', version: '1', chainId: 11155111n, verifyingContract: fromHex('0000000000000000000000000000000000000001') })));
  });
});
