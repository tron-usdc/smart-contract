// contracts/GLDToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockERC20 is ERC20, Ownable {
	constructor(string memory name, string memory symbol, uint256 initialSupply, address initialOwner)
		ERC20(name, symbol)
		Ownable(initialOwner)
	{
		_mint(msg.sender, initialSupply);
	}

	function mint(address to, uint256 amount) public onlyOwner {
		_mint(to, amount);
	}

	function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
		return super.transfer(recipient, amount);
	}

	function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
		return super.transferFrom(sender, recipient, amount);
	}

	function approve(address spender, uint256 amount) public virtual override returns (bool) {
		return super.approve(spender, amount);
	}

	function allowance(address owner, address spender) public view virtual override returns (uint256) {
		return super.allowance(owner, spender);
	}

	function balanceOf(address account) public view virtual override returns (uint256) {
		return super.balanceOf(account);
	}
}