// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MintController} from "../src/MintController.sol";

/// @dev Exposes the EIP-712 digest for an arbitrary domain separator so the Rust-generated
///      vector (`sdk/test/vectors.json`, fixed domain 0xd0…d0) can be checked byte-for-byte.
contract VectorHarness is MintController {
    constructor(address s, bytes32 l) MintController(s, l, "TBILL", "TBILL", address(0), 0) {}

    function digestWithDomain(Authorization calldata a, bytes32 domain) external pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domain, structHashOf(a)));
    }
}

contract MintControllerTest is Test {
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    address internal signer;
    bytes32 internal constant LEDGER = bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111));
    MintController internal c;
    VectorHarness internal h;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        c = new MintController(signer, LEDGER, "Tokenized T-Bill Fund", "TBILL", address(0), 0);
        h = new VectorHarness(signer, LEDGER);
    }

    function _auth(uint8 action, uint256 amount, address account, uint256 nonce) internal pure returns (MintController.Authorization memory) {
        return MintController.Authorization({action: action, amount: amount, account: bytes32(uint256(uint160(account))), nonce: nonce, ledger: LEDGER});
    }

    function _sign65(MintController.Authorization memory a) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, c.digestOf(a));
        return abi.encodePacked(r, s, v);
    }

    function _sign64(MintController.Authorization memory a) internal view returns (bytes memory) {
        (, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, c.digestOf(a));
        return abi.encodePacked(r, s);
    }

    // ── vectors.json: mint-evm-20 (action 0, 2.5M, account 0xaa…aa, nonce 0, ledger 0x11…11, domain 0xd0…d0) ──
    function test_digestMatchesRustVector() public view {
        MintController.Authorization memory a = _auth(0, 2_500_000_000_000, 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa, 0);
        bytes32 domain = bytes32(uint256(0xd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0));
        assertEq(h.structHashOf(a), 0x543e3b10f9406287b7f139aa184036d1f05c015d598453a60d712b711d51ef93, "structHash");
        assertEq(h.digestWithDomain(a, domain), 0xb61583b7473a582ea73fe17d9b8195166ab15946106b34e72e9aa0016d2c3e19, "eip712Digest");
    }

    function test_domainSeparator() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("TBILL MintController"),
                keccak256("1"),
                block.chainid,
                address(c)
            )
        );
        assertEq(c.DOMAIN_SEPARATOR(), expected);
    }

    function test_mintWith65ByteSignature() public {
        MintController.Authorization memory a = _auth(0, 1_000_000, address(0xBEEF), 1);
        c.mintWithAuthorization(a, _sign65(a));
        assertEq(c.balanceOf(address(0xBEEF)), 1_000_000);
        assertEq(c.totalSupply(), 1_000_000);
        assertTrue(c.usedNonces(1));
    }

    function test_mintWith64ByteSignature_ikaFormat() public {
        MintController.Authorization memory a = _auth(0, 7, address(0xBEEF), 2);
        c.mintWithAuthorization(a, _sign64(a));
        assertEq(c.balanceOf(address(0xBEEF)), 7);
    }

    function test_replayRejected() public {
        MintController.Authorization memory a = _auth(0, 5, address(0xBEEF), 3);
        bytes memory sig = _sign65(a);
        c.mintWithAuthorization(a, sig);
        vm.expectRevert(abi.encodeWithSelector(MintController.NonceUsed.selector, 3));
        c.mintWithAuthorization(a, sig);
    }

    function test_wrongLedgerRejected() public {
        MintController.Authorization memory a = _auth(0, 5, address(0xBEEF), 4);
        a.ledger = bytes32(uint256(2));
        bytes memory sig = _sign65(a);
        vm.expectRevert(MintController.WrongLedger.selector);
        c.mintWithAuthorization(a, sig);
    }

    function test_wrongSignerRejected() public {
        MintController.Authorization memory a = _auth(0, 5, address(0xBEEF), 5);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, c.digestOf(a));
        vm.expectRevert(MintController.InvalidSignature.selector);
        c.mintWithAuthorization(a, abi.encodePacked(r, s, v));
    }

    function test_tamperedAmountRejected() public {
        MintController.Authorization memory a = _auth(0, 5, address(0xBEEF), 6);
        bytes memory sig = _sign65(a);
        a.amount = 500;
        vm.expectRevert(MintController.InvalidSignature.selector);
        c.mintWithAuthorization(a, sig);
    }

    function test_burnFromAccount() public {
        MintController.Authorization memory m = _auth(0, 100, address(0xBEEF), 7);
        c.mintWithAuthorization(m, _sign65(m));
        MintController.Authorization memory b = _auth(1, 40, address(0xBEEF), 8);
        c.burnWithAuthorization(b, _sign64(b));
        assertEq(c.balanceOf(address(0xBEEF)), 60);
        assertEq(c.totalSupply(), 60);
    }

    function test_actionMismatchRejected() public {
        MintController.Authorization memory b = _auth(1, 1, address(0xBEEF), 9);
        bytes memory sig = _sign65(b);
        vm.expectRevert(MintController.WrongAction.selector);
        c.mintWithAuthorization(b, sig);
    }

    function test_genesis_supply_goes_to_treasury() public {
        address treasury = address(0xBEEF);
        MintController g = new MintController(signer, LEDGER, "Tokenized T-Bill Fund", "TBILL", treasury, 7_500_000e6);
        assertEq(g.balanceOf(treasury), 7_500_000e6);
        assertEq(g.totalSupply(), 7_500_000e6);
    }
}
