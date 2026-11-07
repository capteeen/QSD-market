// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply ERC-20 launched on Elysium. Gas is native HYPE.
///         Trading happens in a Uniswap v2 pool against canonical WHYPE; this
///         contract does not take a fee. Metadata is immutable. No fee-on-transfer.
contract InfinitwapToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address recipient) ERC20(name_, symbol_) {
        if (recipient == address(0)) revert RecipientZero();
        if (supply == 0) revert SupplyZero();
        _mint(recipient, supply);
    }

    error RecipientZero();
    error SupplyZero();
}
