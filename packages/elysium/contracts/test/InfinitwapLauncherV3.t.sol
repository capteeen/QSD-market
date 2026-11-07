// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {InfinitwapLauncherV3} from "../src/InfinitwapLauncherV3.sol";
import {InfinitwapToken} from "../src/InfinitwapToken.sol";

contract MockPositionManager {
    address public immutable factory;
    address public immutable WETH9;
    address public pool = address(0xB0B);
    uint256 public amount0;
    uint256 public amount1;
    address public nftOwner;
    uint256 public tokenId = 1;

    constructor(address factory_, address whype) {
        factory = factory_;
        WETH9 = whype;
    }

    function createAndInitializePoolIfNecessary(address, address, uint24, uint160) external pure returns (address) {
        return address(0xB0B);
    }

    function mint(IMint.MintParams calldata params)
        external
        returns (uint256, uint128, uint256, uint256)
    {
        uint256 wanted = params.amount0Desired > 0 ? params.amount0Desired : params.amount1Desired;
        require(ERC20(params.amount0Desired > 0 ? params.token0 : params.token1).transferFrom(msg.sender, address(this), wanted), "pull");
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
        nftOwner = params.recipient;
        return (tokenId, 1, amount0, amount1);
    }

    function transferFrom(address from, address to, uint256 id) external {
        require(id == tokenId, "id");
        require(from == nftOwner, "from");
        nftOwner = to;
    }
}

interface IMint {
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
}

contract MockSwapRouter {
    uint256 public bought;

    function exactInputSingle(IRouter.ExactInputSingleParams calldata params) external payable returns (uint256) {
        require(msg.value == params.amountIn, "value");
        bought = params.amountIn;
        return 1234;
    }
}

interface IRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
}

contract InfinitwapLauncherV3Test is Test {
    MockPositionManager internal npm;
    MockSwapRouter internal router;
    InfinitwapLauncherV3 internal launcher;
    address internal constant WHYPE = address(0xBEEF);

    function setUp() public {
        npm = new MockPositionManager(address(0xFACADE), WHYPE);
        router = new MockSwapRouter();
        launcher = new InfinitwapLauncherV3(address(npm), address(router));
    }

    function _predict(string memory name, string memory symbol, uint256 supply, bytes32 salt, address recipient) internal view returns (address) {
        bytes memory initCode = abi.encodePacked(type(InfinitwapToken).creationCode, abi.encode(name, symbol, supply, recipient));
        return vm.computeCreate2Address(salt, keccak256(initCode), address(launcher));
    }

    function testZeroHypeMintWhenTokenIsToken0AndOptionalBuy() public {
        uint256 supply = 1_000_000 ether;
        address creator = address(0xCAFE);
        bytes32 salt = bytes32(uint256(7));
        // token address must sort below WHYPE. CREATE2 with this salt happens to be checked below.
        address predicted = _predict("Photon", "PHO", supply, salt, address(launcher));
        uint256 buy = 1 ether;
        (address token, address pool, uint256 tokensOut) = launcher.launch{value: buy}("Photon", "PHO", supply, creator, buy, salt);

        assertEq(token, predicted);
        assertEq(pool, address(0xB0B));
        assertEq(tokensOut, 1234);
        assertEq(router.bought(), buy);
        assertEq(npm.nftOwner(), launcher.DEAD());
        assertEq(address(launcher).balance, 0);
        if (token < WHYPE) {
            assertEq(npm.amount0(), supply);
            assertEq(npm.amount1(), 0);
        } else {
            assertEq(npm.amount0(), 0);
            assertEq(npm.amount1(), supply);
        }
        assertEq(InfinitwapToken(token).balanceOf(address(launcher)), 0);
    }

    function testZeroHypeAndNoFirstBuy() public {
        uint256 supply = 100 ether;
        (address token,, uint256 tokensOut) = launcher.launch{value: 0}("Photon", "PHO", supply, address(0xCAFE), 0, bytes32(uint256(8)));
        assertEq(tokensOut, 0);
        assertEq(router.bought(), 0);
        assertEq(npm.nftOwner(), launcher.DEAD());
        assertTrue(npm.amount0() == 0 || npm.amount1() == 0);
        assertEq(InfinitwapToken(token).totalSupply(), supply);
    }

    function testRejectsValueThatIsNotTheFirstBuy() public {
        vm.expectRevert(InfinitwapLauncherV3.ValueMismatch.selector);
        launcher.launch{value: 2 ether}("Photon", "PHO", 100 ether, address(0xCAFE), 1 ether, bytes32(uint256(9)));
    }
}
