// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {InfinitwapToken} from "./InfinitwapToken.sol";

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IERC721 {
    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface INonfungiblePositionManager {
    function factory() external view returns (address);
    function WETH9() external view returns (address);

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Opens an Infinitwap coin in official Uniswap v3 with no WHYPE deposited.
///         The whole supply is minted into a one-sided range at a small price.
///         The position NFT is sent to the dead address so the liquidity cannot be pulled.
///         An optional first buy is swapped to the creator in the same transaction.
contract InfinitwapLauncherV3 {
    address public immutable positionManager;
    address public immutable swapRouter;
    address public immutable factory;
    address public immutable whype;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    /// 1% fee. Tick spacing on the official factory is 200.
    uint24 public constant FEE = 10_000;
    int24 public constant TICK_SPACING = 200;
    int24 public constant MIN_TICK = -887_200;
    int24 public constant MAX_TICK = 887_200;
    /// Edge used by the verified PERPME official-v3 launch. Aligned to TICK_SPACING.
    int24 public constant OPEN_TICK = 171_200;
    /// getSqrtRatioAtTick(-OPEN_TICK) and getSqrtRatioAtTick(OPEN_TICK).
    uint160 public constant SQRT_PRICE_TOKEN0 = 15188143238656416903931307;
    uint160 public constant SQRT_PRICE_TOKEN1 = 413289606027047825779829875799454;

    uint256 private locked = 1;

    event Launched(
        address indexed token,
        address indexed creator,
        address pool,
        uint256 tokensOut,
        uint256 firstBuyWei
    );

    error ValueMismatch();
    error CreatorZero();
    error TokenIsWhype();
    error QuoteDeposited();
    error NoTokens();
    error RefundFailed();
    error Reentered();

    constructor(address positionManager_, address swapRouter_) {
        positionManager = positionManager_;
        swapRouter = swapRouter_;
        factory = INonfungiblePositionManager(positionManager_).factory();
        whype = INonfungiblePositionManager(positionManager_).WETH9();
    }

    /// @param firstBuyWei HYPE swapped for tokens and sent to `creator`. Zero deposits no HYPE.
    function launch(
        string calldata name,
        string calldata symbol,
        uint256 supply,
        address creator,
        uint256 firstBuyWei,
        bytes32 salt
    ) external payable returns (address token, address pool, uint256 tokensOut) {
        if (locked != 1) revert Reentered();
        locked = 2;
        if (msg.value != firstBuyWei) revert ValueMismatch();
        if (creator == address(0) || creator == address(this)) revert CreatorZero();

        InfinitwapToken created = new InfinitwapToken{salt: salt}(name, symbol, supply, address(this));
        token = address(created);
        if (token == whype) revert TokenIsWhype();

        pool = _open(token, supply);
        if (firstBuyWei > 0) tokensOut = _buy(token, creator, firstBuyWei);

        uint256 leftoverTokens = IERC20(token).balanceOf(address(this));
        if (leftoverTokens > 0) {
            if (!IERC20(token).transfer(creator, leftoverTokens)) revert RefundFailed();
        }
        uint256 leftover = address(this).balance;
        if (leftover > 0) {
            (bool ok,) = msg.sender.call{value: leftover}("");
            if (!ok) revert RefundFailed();
        }

        emit Launched(token, creator, pool, tokensOut, firstBuyWei);
        locked = 1;
    }

    function _open(address token, uint256 supply) internal returns (address pool) {
        bool tokenIs0 = token < whype;
        address token0 = tokenIs0 ? token : whype;
        address token1 = tokenIs0 ? whype : token;
        int24 lower = tokenIs0 ? -OPEN_TICK : MIN_TICK;
        int24 upper = tokenIs0 ? MAX_TICK : OPEN_TICK;
        uint160 sqrtPrice = tokenIs0 ? SQRT_PRICE_TOKEN0 : SQRT_PRICE_TOKEN1;

        pool = INonfungiblePositionManager(positionManager).createAndInitializePoolIfNecessary(token0, token1, FEE, sqrtPrice);
        if (!IERC20(token).approve(positionManager, supply)) revert RefundFailed();

        (uint256 tokenId,, uint256 amount0, uint256 amount1) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: FEE,
                tickLower: lower,
                tickUpper: upper,
                amount0Desired: tokenIs0 ? supply : 0,
                amount1Desired: tokenIs0 ? 0 : supply,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        if (tokenIs0) {
            if (amount1 != 0) revert QuoteDeposited();
            if (amount0 == 0) revert NoTokens();
        } else {
            if (amount0 != 0) revert QuoteDeposited();
            if (amount1 == 0) revert NoTokens();
        }
        IERC721(positionManager).transferFrom(address(this), DEAD, tokenId);
    }

    function _buy(address token, address creator, uint256 firstBuyWei) internal returns (uint256 tokensOut) {
        tokensOut = ISwapRouter02(swapRouter).exactInputSingle{value: firstBuyWei}(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: whype,
                tokenOut: token,
                fee: FEE,
                recipient: creator,
                amountIn: firstBuyWei,
                amountOutMinimum: 1,
                sqrtPriceLimitX96: 0
            })
        );
        if (tokensOut == 0) revert NoTokens();
    }

    receive() external payable {}
}
