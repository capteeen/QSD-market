// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {InfinitwapToken} from "../src/InfinitwapToken.sol";

contract InfinitwapTokenTest is Test {
    function testMintsSupplyToRecipient() public {
        InfinitwapToken token = new InfinitwapToken("Photon", "PHO", 1_000_000 ether, address(this));
        assertEq(token.totalSupply(), 1_000_000 ether);
        assertEq(token.balanceOf(address(this)), 1_000_000 ether);
        assertEq(token.name(), "Photon");
        assertEq(token.symbol(), "PHO");
        assertEq(token.decimals(), 18);
    }

    function testRejectsZeroRecipient() public {
        vm.expectRevert(InfinitwapToken.RecipientZero.selector);
        new InfinitwapToken("Photon", "PHO", 1 ether, address(0));
    }
}
