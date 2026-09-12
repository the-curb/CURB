// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { console2 } from "forge-std/console2.sol";

/**
 * T14, on the record: a corporate action across a recorded block.
 *
 * The issuer publishes a multiplier for AAPLx before each corporate action
 * and activates it at 00:30 UTC the day after the ex-date; on EVM chains
 * the raw token's balanceOf moves with it. The series holds the current
 * wrapper, whose share count is documented to change only on deposit and
 * redeem. This test forks Ethereum at the block before the last activation
 * and at the activation block, and reads both sides: the raw multiplier,
 * the wrapper's total shares, the wrapper's raw balance, and the wrapper's
 * conversion rate.
 *
 * The activation block was found by a binary search of multiplier() over
 * archive state (scripts in the repository's scratch, read-only), not taken
 * from any document. Two forks at pinned blocks need an archive endpoint in
 * ETH_RPC_URL; a node that does not serve that state fails this test
 * loudly rather than answering from the wrong block.
 */
interface IRawLike {
    function multiplier() external view returns (uint256);
    function sharesOf(address) external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface IWrapperLike {
    function totalSupply() external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
}

contract AppleCorporateActionForkTest is Test {
    address constant RAW = 0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a;
    address constant WRAPPER_V2 = 0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f;
    /// The block in which raw AAPLx's multiplier() last moved: 2026-08-08 00:30:11 UTC, the day after an ex-date.
    uint256 constant ACTIVATION = 25_706_680;

    struct Side {
        uint256 blockNumber;
        uint256 timestamp;
        uint256 multiplier;
        uint256 wrapperShares;
        uint256 wrapperRawBalance;
        uint256 wrapperSharesOnRaw;
        uint256 convertToAssets1e18;
        uint256 rawTotalSupply;
    }

    function _read() internal view returns (Side memory s) {
        s.blockNumber = block.number;
        s.timestamp = block.timestamp;
        s.multiplier = IRawLike(RAW).multiplier();
        s.wrapperShares = IWrapperLike(WRAPPER_V2).totalSupply();
        s.wrapperRawBalance = IRawLike(RAW).balanceOf(WRAPPER_V2);
        s.wrapperSharesOnRaw = IRawLike(RAW).sharesOf(WRAPPER_V2);
        s.convertToAssets1e18 = IWrapperLike(WRAPPER_V2).convertToAssets(1e18);
        s.rawTotalSupply = IRawLike(RAW).totalSupply();
    }

    function _sideJson(Side memory s) internal pure returns (string memory) {
        return string.concat(
            '{ "block": ', vm.toString(s.blockNumber),
            ', "timestamp": ', vm.toString(s.timestamp),
            ', "multiplier": "', vm.toString(s.multiplier),
            '", "wrapperShares": "', vm.toString(s.wrapperShares),
            '", "wrapperRawBalance": "', vm.toString(s.wrapperRawBalance),
            '", "wrapperSharesOnRaw": "', vm.toString(s.wrapperSharesOnRaw),
            '", "convertToAssets1e18": "', vm.toString(s.convertToAssets1e18),
            '", "rawTotalSupply": "', vm.toString(s.rawTotalSupply),
            '" }'
        );
    }

    function test_Fork_T14_WrapperSharesAreStaticAcrossAnActivation() public {
        vm.createSelectFork(vm.rpcUrl("mainnet"), ACTIVATION - 1);
        Side memory before = _read();
        vm.createSelectFork(vm.rpcUrl("mainnet"), ACTIVATION);
        Side memory afterwards = _read();

        console2.log("multiplier before", before.multiplier);
        console2.log("multiplier after ", afterwards.multiplier);
        console2.log("wrapper shares before / after", before.wrapperShares, afterwards.wrapperShares);
        console2.log("wrapper raw balance before / after", before.wrapperRawBalance, afterwards.wrapperRawBalance);

        bool multiplierMoved = afterwards.multiplier != before.multiplier;
        bool sharesStatic = afterwards.wrapperShares == before.wrapperShares && afterwards.wrapperSharesOnRaw == before.wrapperSharesOnRaw;
        bool rawBalanceMoved = afterwards.wrapperRawBalance != before.wrapperRawBalance;
        bool conversionTracksMultiplier = afterwards.convertToAssets1e18 == afterwards.multiplier && before.convertToAssets1e18 == before.multiplier;

        string memory json = string.concat(
            "{\n",
            '  "seriesId": "apple-s1",\n',
            '  "chainId": 1,\n',
            '  "component": "A",\n',
            '  "raw": "', vm.toString(RAW), '",\n',
            '  "wrapperV2": "', vm.toString(WRAPPER_V2), '",\n',
            '  "activationBlock": ', vm.toString(ACTIVATION), ",\n",
            '  "before": ', _sideJson(before), ",\n",
            '  "after": ', _sideJson(afterwards), ",\n"
        );
        json = string.concat(
            json,
            '  "findings": {\n',
            '    "multiplierMoved": ', multiplierMoved ? "true" : "false", ",\n",
            '    "wrapperSharesStatic": ', sharesStatic ? "true" : "false", ",\n",
            '    "wrapperRawBalanceMoved": ', rawBalanceMoved ? "true" : "false", ",\n",
            '    "conversionTracksMultiplier": ', conversionTracksMultiplier ? "true" : "false", "\n",
            "  },\n",
            '  "notProven": [\n',
            '    "the same for a split or a reverse split: this activation was a dividend reinvestment",\n',
            '    "anything about component B across this block: its dividends are documented as reflected in price, not balance, and are not read here",\n',
            '    "that the next activation behaves the same: each is a new event on the record"\n',
            "  ],\n",
            '  "how": "contracts/test/fork/AppleCorporateActionFork.t.sol on two forks of Ethereum at the block before and at the activation block, archive state; nothing sent"\n',
            "}\n"
        );
        vm.writeFile("evidence/apple-s1.corporate-action.json", json);

        assertTrue(multiplierMoved, "the multiplier moved in the activation block");
        assertTrue(sharesStatic, "the wrapper's shares did not move (T14)");
        assertTrue(rawBalanceMoved, "the wrapper's raw balance moved with the multiplier");
    }
}
