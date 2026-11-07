// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {InfinitwapToken} from "./InfinitwapToken.sol";

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV2Router {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

/// @notice Opens an Infinitwap coin.
///         With seedWei 0 the whole supply is minted to the creator and no
///         pool is opened, so the price starts at 0. The creator adds
///         liquidity in whatever pool they choose.
///         With seedWei above 0, one transaction also puts the whole supply
///         into a Uniswap v2 pool against WHYPE, burns the liquidity, then
///         buys tokens for the creator with the optional first buy.
contract InfinitwapLauncher {
    address public immutable router;
    address public immutable factory;
    address public immutable whype;

    /// Liquidity is sent here so nobody can withdraw it.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 private locked = 1;

    event Launched(
        address indexed token,
        address indexed creator,
        address pair,
        uint256 tokensOut,
        uint256 seedWei,
        uint256 firstBuyWei
    );

    error ValueMismatch();
    error FirstBuyNeedsPool();
    error CreatorZero();
    error PairMissing();
    error LiquidityMissing();
    error NoTokens();
    error RefundFailed();
    error Reentered();

    constructor(address router_) {
        router = router_;
        factory = IUniswapV2Router(router_).factory();
        whype = IUniswapV2Router(router_).WETH();
    }

    /// @param salt CREATE2 salt chosen by the caller so the token address is known before this transaction.
    /// @param seedWei HYPE deposited as the pool's HYPE side. Zero mints the supply to `creator` and opens no pool.
    /// @param firstBuyWei HYPE swapped for tokens and sent to `creator` in this same transaction. Zero unless a pool is seeded.
    function launch(
        string calldata name,
        string calldata symbol,
        uint256 supply,
        address creator,
        uint256 firstBuyWei,
        uint256 seedWei,
        bytes32 salt
    ) external payable returns (address token, address pair, uint256 tokensOut) {
        if (locked != 1) revert Reentered();
        locked = 2;
        if (msg.value != seedWei + firstBuyWei) revert ValueMismatch();
        if (creator == address(0) || creator == address(this)) revert CreatorZero();
        if (seedWei == 0) {
            if (firstBuyWei != 0) revert FirstBuyNeedsPool();
            InfinitwapToken opened = new InfinitwapToken{salt: salt}(name, symbol, supply, creator);
            token = address(opened);
            emit Launched(token, creator, address(0), 0, 0, 0);
            locked = 1;
            return (token, address(0), 0);
        }

        InfinitwapToken created = new InfinitwapToken{salt: salt}(name, symbol, supply, address(this));
        token = address(created);
        created.approve(router, supply);

        IUniswapV2Router(router).addLiquidityETH{value: seedWei}(token, supply, supply, seedWei, address(this), block.timestamp);

        pair = IUniswapV2Factory(factory).getPair(token, whype);
        if (pair == address(0)) revert PairMissing();
        uint256 lp = IERC20(pair).balanceOf(address(this));
        if (lp == 0) revert LiquidityMissing();
        IERC20(pair).transfer(DEAD, lp);

        if (firstBuyWei > 0) tokensOut = _buy(token, creator, firstBuyWei);

        uint256 leftover = address(this).balance;
        if (leftover > 0) {
            (bool ok,) = msg.sender.call{value: leftover}("");
            if (!ok) revert RefundFailed();
        }

        emit Launched(token, creator, pair, tokensOut, seedWei, firstBuyWei);
        locked = 1;
    }

    function _buy(address token, address creator, uint256 firstBuyWei) internal returns (uint256 tokensOut) {
        address[] memory path = new address[](2);
        path[0] = whype;
        path[1] = token;
        uint256 quoted = IUniswapV2Router(router).getAmountsOut(firstBuyWei, path)[1];
        uint256 minOut = (quoted * 99) / 100;
        if (minOut == 0) revert NoTokens();
        uint256[] memory amounts = IUniswapV2Router(router).swapExactETHForTokens{value: firstBuyWei}(minOut, path, creator, block.timestamp);
        tokensOut = amounts[amounts.length - 1];
    }

    receive() external payable {}
}
