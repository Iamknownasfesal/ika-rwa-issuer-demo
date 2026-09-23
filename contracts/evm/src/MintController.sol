// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @title TBILL MintController
/// @notice Minimal ERC-20 whose supply can only change with an EIP-712 authorization signed by the
///         issuer's Ika dWallet (a secp256k1 key whose network share is controlled by the Solana
///         issuer-ledger program). Any relayer can submit a valid authorization and pay gas.
/// @dev Self-contained reference implementation (no OpenZeppelin). Not audited.
contract MintController {
    // ── ERC-20 ──
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ── Authorization ──
    struct Authorization {
        uint8 action;    // 0 = mint, 1 = burn
        uint256 amount;  // base units (6 decimals, same as the Solana ledger)
        bytes32 account; // bytes32(uint256(uint160(address)))
        uint256 nonce;   // (intent_index << 1) | leg_index — unique per leg
        bytes32 ledger;  // Solana Asset PDA that authorized this leg
    }

    bytes32 public constant AUTHORIZATION_TYPEHASH =
        keccak256("IssuerAuthorization(uint8 action,uint256 amount,bytes32 account,uint256 nonce,bytes32 ledger)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @notice The dWallet's EVM address (mint/burn authority). Immutable: rotating it means a new controller.
    address public immutable dwalletSigner;
    /// @notice The Solana Asset PDA (32 bytes) this controller is bound to.
    bytes32 public immutable ledger;
    bytes32 public immutable DOMAIN_SEPARATOR;

    mapping(uint256 => bool) public usedNonces;

    event Authorized(uint8 indexed action, uint256 amount, address indexed account, uint256 indexed nonce);

    error InvalidSignature();
    error NonceUsed(uint256 nonce);
    error WrongLedger();
    error WrongAction();
    error InsufficientBalance();

    /// @param _genesisTo     treasury that receives the starting supply
    /// @param _genesisAmount starting supply; the Solana ledger records the same amount for this chain
    ///                       when the chain is registered, so the two start equal
    constructor(
        address _dwalletSigner,
        bytes32 _ledger,
        string memory _name,
        string memory _symbol,
        address _genesisTo,
        uint256 _genesisAmount
    ) {
        dwalletSigner = _dwalletSigner;
        ledger = _ledger;
        name = _name;
        symbol = _symbol;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("TBILL MintController"), keccak256("1"), block.chainid, address(this))
        );
        if (_genesisAmount > 0) {
            totalSupply = _genesisAmount;
            balanceOf[_genesisTo] = _genesisAmount;
            emit Transfer(address(0), _genesisTo, _genesisAmount);
        }
    }

    // ── Authorized supply changes ──

    function mintWithAuthorization(Authorization calldata a, bytes calldata sig) external {
        if (a.action != 0) revert WrongAction();
        address to = _verify(a, sig);
        totalSupply += a.amount;
        balanceOf[to] += a.amount;
        emit Transfer(address(0), to, a.amount);
        emit Authorized(0, a.amount, to, a.nonce);
    }

    /// @notice Burns `amount` from `account` (the treasury address recorded in the Solana intent).
    ///         The controller is the only party that can reduce supply, and only with a ledger-approved
    ///         authorization: holders do not need to approve the controller.
    function burnWithAuthorization(Authorization calldata a, bytes calldata sig) external {
        if (a.action != 1) revert WrongAction();
        address from = _verify(a, sig);
        if (balanceOf[from] < a.amount) revert InsufficientBalance();
        balanceOf[from] -= a.amount;
        totalSupply -= a.amount;
        emit Transfer(from, address(0), a.amount);
        emit Authorized(1, a.amount, from, a.nonce);
    }

    /// @dev Reproduces exactly the digest the Solana ledger computed and the dWallet signed.
    function digestOf(Authorization calldata a) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHashOf(a)));
    }

    function _verify(Authorization calldata a, bytes calldata sig) internal returns (address account) {
        if (a.ledger != ledger) revert WrongLedger();
        if (usedNonces[a.nonce]) revert NonceUsed(a.nonce);
        usedNonces[a.nonce] = true;
        if (_recover(digestOf(a), sig) != dwalletSigner) revert InvalidSignature();
        account = address(uint160(uint256(a.account)));
    }

    /// @dev Accepts either a 65-byte (r,s,v) signature or the 64-byte r||s that the Ika network
    ///      returns (no recovery id): for 64 bytes both recovery ids are tried against `dwalletSigner`.
    ///      Low-s is enforced to keep signatures non-malleable (nonces already prevent replay).
    function _recover(bytes32 digest, bytes calldata sig) internal view returns (address) {
        if (sig.length != 64 && sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        if (sig.length == 65) {
            uint8 v = uint8(sig[64]);
            if (v < 27) v += 27;
            return ecrecover(digest, v, r, s);
        }
        address a27 = ecrecover(digest, 27, r, s);
        if (a27 == dwalletSigner) return a27;
        return ecrecover(digest, 28, r, s);
    }

    /// @dev EIP-712 struct hash, exposed so off-chain vectors can be checked independently of the domain.
    function structHashOf(Authorization calldata a) public pure returns (bytes32) {
        return keccak256(abi.encode(AUTHORIZATION_TYPEHASH, a.action, a.amount, a.account, a.nonce, a.ledger));
    }

    // ── plain ERC-20 transfers ──

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientBalance();
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (balanceOf[from] < value) revert InsufficientBalance();
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
