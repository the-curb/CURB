// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * A stand-in for a constant-product pool, for rehearsals only: two tokens
 * and reserves that can be set. It exists so the site's rate reader —
 * token0(), token1(), getReserves() at a block — can be rehearsed on a
 * local chain with a mock CURB and a mock dollar before any pool exists.
 * It trades nothing.
 */
contract MockPair {
    address public immutable token0;
    address public immutable token1;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    event Sync(uint112 reserve0, uint112 reserve1);

    constructor(address token0_, address token1_) {
        require(token0_ != token1_ && token0_ != address(0) && token1_ != address(0), "tokens");
        token0 = token0_;
        token1 = token1_;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    /// The rehearsal moves the price by setting the reserves; a real pool moves them by trades.
    function setReserves(uint112 reserve0_, uint112 reserve1_) external {
        reserve0 = reserve0_;
        reserve1 = reserve1_;
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserve0_, reserve1_);
    }
}
