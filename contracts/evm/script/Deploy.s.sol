// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MintController} from "../src/MintController.sol";

/// @notice `forge script script/Deploy.s.sol --rpc-url <chain> --broadcast` with
///         DWALLET_SIGNER (address) and LEDGER (bytes32, Solana Asset PDA) in the environment.
///         The TypeScript deployer (`scripts/deploy-evm.ts`) is the primary path; this is the Foundry equivalent.
contract Deploy is Script {
    function run() external {
        address signer = vm.envAddress("DWALLET_SIGNER");
        bytes32 ledger = vm.envBytes32("LEDGER");
        vm.startBroadcast();
        MintController c = new MintController(signer, ledger, "Tokenized T-Bill Fund", "TBILL", msg.sender, vm.envOr("GENESIS_AMOUNT", uint256(0)));
        vm.stopBroadcast();
        console.log("MintController", address(c));
    }
}
