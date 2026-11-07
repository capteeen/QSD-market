// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {InfinitwapLauncher} from "../src/InfinitwapLauncher.sol";
import {InfinitwapToken} from "../src/InfinitwapToken.sol";

contract MockLp is ERC20 {
    constructor() ERC20("LP", "LP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockFactory {
    address public pair;

    function setPair(address p) external {
        pair = p;
    }

    function getPair(address, address) external view returns (address) {
        return pair;
    }
}

contract MockRouter {
    address public immutable factory;
    address public immutable WETH;
    MockLp public lp;
    uint256 public tokenBalance;

    constructor(address factory_, address whype) {
        factory = factory_;
        WETH = whype;
        lp = new MockLp();
    }

    function addLiquidityETH(address token, uint256 amountTokenDesired, uint256, uint256 amountETHMin, address to, uint256)
        external
        payable
        returns (uint256, uint256, uint256)
    {
        require(msg.value >= amountETHMin, "eth");
        require(ERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired), "pull");
        tokenBalance += amountTokenDesired;
        lp.mint(to, 1 ether);
        return (amountTokenDesired, msg.value, 1 ether);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata) external pure returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn * 1000;
    }

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256) external payable returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = msg.value;
        amounts[1] = msg.value * 1000;
        require(amounts[1] >= amountOutMin, "slip");
        require(tokenBalance >= amounts[1], "inv");
        tokenBalance -= amounts[1];
        require(ERC20(path[1]).transfer(to, amounts[1]), "send");
    }
}

contract InfinitwapLauncherTest is Test {
    MockFactory internal factory;
    MockRouter internal router;
    InfinitwapLauncher internal launcher;

    function setUp() public {
        factory = new MockFactory();
        router = new MockRouter(address(factory), address(0xBEEF));
        factory.setPair(address(router.lp()));
        launcher = new InfinitwapLauncher(address(router));
    }

    function _predict(string memory name, string memory symbol, uint256 supply, bytes32 salt) internal view returns (address) {
        bytes memory initCode = abi.encodePacked(type(InfinitwapToken).creationCode, abi.encode(name, symbol, supply, address(launcher)));
        return vm.computeCreate2Address(salt, keccak256(initCode), address(launcher));
    }

    function testLaunchSeedsThePoolAndFillsTheFirstBuy() public {
        uint256 supply = 1_000_000 ether;
        uint256 seed = 30 ether;
        uint256 buy = 1 ether;
        address creator = address(0xCAFE);
        bytes32 salt = bytes32(uint256(1));
        address predicted = _predict("Photon", "PHO", supply, salt);

        (address token, address pair, uint256 tokensOut) = launcher.launch{value: seed + buy}("Photon", "PHO", supply, creator, buy, seed, salt);

        assertEq(token, predicted);
        assertEq(pair, address(router.lp()));
        assertEq(tokensOut, buy * 1000);
        assertEq(InfinitwapToken(token).balanceOf(creator), tokensOut);
        assertEq(router.lp().balanceOf(launcher.DEAD()), 1 ether);
        assertEq(router.lp().balanceOf(address(launcher)), 0);
        assertEq(address(launcher).balance, 0);
        assertEq(InfinitwapToken(token).totalSupply(), supply);
    }

    function testLaunchWithNoFirstBuyStillLocksThePool() public {
        uint256 supply = 1_000_000 ether;
        (address token,, uint256 tokensOut) = launcher.launch{value: 30 ether}("Photon", "PHO", supply, address(0xCAFE), 0, 30 ether, bytes32(uint256(2)));
        assertEq(tokensOut, 0);
        assertEq(InfinitwapToken(token).balanceOf(address(0xCAFE)), 0);
        assertEq(router.lp().balanceOf(launcher.DEAD()), 1 ether);
        assertEq(router.tokenBalance(), supply);
    }

    function testRejectsAPaymentThatIsNotSeedPlusFirstBuy() public {
        vm.expectRevert(InfinitwapLauncher.ValueMismatch.selector);
        launcher.launch{value: 1 ether}("Photon", "PHO", 100 ether, address(0xCAFE), 1 ether, 30 ether, bytes32(uint256(3)));
    }

    function testZeroSeedMintsTheSupplyToTheCreatorAndOpensNoPool() public {
        uint256 supply = 1_000_000 ether;
        address creator = address(0xCAFE);
        bytes32 salt = bytes32(uint256(4));
        bytes memory initCode = abi.encodePacked(type(InfinitwapToken).creationCode, abi.encode("Photon", "PHO", supply, creator));
        address predicted = vm.computeCreate2Address(salt, keccak256(initCode), address(launcher));

        (address token, address pair, uint256 tokensOut) = launcher.launch{value: 0}("Photon", "PHO", supply, creator, 0, 0, salt);

        assertEq(token, predicted);
        assertEq(pair, address(0));
        assertEq(tokensOut, 0);
        assertEq(InfinitwapToken(token).balanceOf(creator), supply);
        assertEq(address(launcher).balance, 0);
    }

    function testZeroSeedRejectsAFirstBuy() public {
        vm.expectRevert(InfinitwapLauncher.FirstBuyNeedsPool.selector);
        launcher.launch{value: 1 ether}("Photon", "PHO", 100 ether, address(0xCAFE), 1 ether, 0, bytes32(uint256(5)));
    }
}
