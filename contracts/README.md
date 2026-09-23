# Destination-chain contracts

The ledger never signs a raw destination transaction. For every foreign leg it computes a canonical
*authorization message* (`programs/issuer-ledger/src/digest.rs`) and asks the Ika dWallet to sign it.
The destination contract verifies that signature over the same bytes, so anyone can relay it and pay
gas, and nothing can be minted or burned that the Solana ledger did not approve.

| chain family | signer | encoding | contract |
|---|---|---|---|
| EVM (Ethereum Sepolia, Base Sepolia, Tempo Moderato) | secp256k1 dWallet | EIP-712 `IssuerAuthorization(uint8 action,uint256 amount,bytes32 account,uint256 nonce,bytes32 ledger)` | `evm/src/MintController.sol` |
| Sui testnet | Ed25519 dWallet | raw 161-byte message (`IKA_RWA_AUTH_V1 …`) | `sui/` |

## EVM: `MintController` (Foundry)

Self-contained ERC-20 (`TBILL`, 6 decimals) whose supply only changes through
`mintWithAuthorization(Authorization, sig)` / `burnWithAuthorization(Authorization, sig)`:

* `dwalletSigner` (immutable): the secp256k1 dWallet's EVM address; `ecrecover` must return it.
* `ledger` (immutable): the Solana Asset PDA (32 bytes); authorizations for another ledger revert.
* `usedNonces`: replay protection; the nonce is `(intent_index << 1) | leg_index`.
* Signatures: 65-byte `r||s||v`, or the 64-byte `r||s` the Ika network returns (both recovery ids tried).
* `burnWithAuthorization` burns from `account` (the treasury recorded in the Solana intent) without an
  allowance: the controller is the only party able to reduce supply, and only with a ledger-approved
  authorization.
* `DOMAIN_SEPARATOR()` = EIP-712 domain `{name: "TBILL MintController", version: "1", chainId, verifyingContract}`;
  `structHashOf()` / `digestOf()` expose the hashes for audit.

```bash
export PATH=$HOME/.foundry/bin:$PATH
cd contracts/evm
forge build
forge test -vv            # includes the byte-for-byte check against sdk/test/vectors.json
```

Deploy to the three testnets and record addresses in `deployments/evm.json`:

```bash
pnpm deploy:evm                       # sepolia, base-sepolia, tempo-moderato (skips unfunded chains)
pnpm deploy:evm --only tempo-moderato # Tempo funds itself from the public faucet (tempo_fundAddress)
```

Fund the printed deployer address with Sepolia ETH / Base Sepolia ETH first (faucet links are printed).
Tempo has no native gas token: fees are paid in pathUSD via the 0x76 transaction type, which viem's
Tempo client (`viem/tempo`) serializes; the faucet sends 1M of each test stablecoin.

The Foundry equivalent: `DWALLET_SIGNER=0x… LEDGER=0x… forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --private-key $EVM_DEPLOYER_KEY`.

Then run legs with real delivery: `DELIVER=evm pnpm executor run --intent <n>`.
