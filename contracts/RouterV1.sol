// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";

import { TrancheData, BondHelpers, TrancheDataHelpers } from "./_utils/BondHelpers.sol";

import { IPerpetualTranche } from "./_interfaces/IPerpetualTranche.sol";
import { IBondController } from "./_interfaces/buttonwood/IBondController.sol";
import { ITranche } from "./_interfaces/buttonwood/ITranche.sol";

/*
 *  @title RouterV1
 *
 *  @notice Contract to batch multiple operations.
 *
 */
contract RouterV1 {
    using SafeCast for uint256;
    using SignedMath for int256;
    using SafeERC20 for IERC20;
    using SafeERC20 for ITranche;
    using SafeERC20 for IPerpetualTranche;
    using BondHelpers for IBondController;
    using TrancheDataHelpers for TrancheData;

    // @notice Calculates the amount of perp tokens that can be minted and fees for the operation.
    // @dev Used by off-chain services to dry-run a combined tranche and deposit operation.
    // @param perp Address of the perpetual tranche contract.
    // @param collateralAmount The amount of collateral the user wants to tranche.
    // @return mintAmt The amount of perp tokens minted.
    // @return feeToken The address of the fee token.
    // @return mintFee The fee charged for minting.
    function previewTrancheAndDeposit(IPerpetualTranche perp, uint256 collateralAmount)
        external
        returns (uint256 mintAmt, IERC20 feeToken, int256 mintFee)
    {
        IBondController bond = perp.getDepositBond();
        (TrancheData memory td, uint256[] memory trancheAmts, ) = bond.previewDeposit(collateralAmount);
        for (uint8 i = 0; i < td.trancheCount; i++) {
            mintAmt += perp.tranchesToPerps(td.tranches[i], trancheAmts[i]);
        }

        feeToken = perp.feeToken();
        mintFee = perp.feeStrategy().computeMintFee(mintAmt);

        // When the fee is charged in the native token, it's withheld
        if (address(feeToken) == address(perp)) {
            mintAmt = (mintAmt.toInt256() - mintFee).abs();
        }

        return (mintAmt, feeToken, mintFee);
    }

    // @notice Calculates the tranche tokens that can be redeemed for burning up to
    //         the requested amount of perp tokens.
    // @dev Used by off-chain services to dry-run a redeem operation.
    // @dev Set maxTranches to max(uint256) to try to redeem the entire queue.
    // @param perp Address of the perpetual tranche contract.
    // @param requestedAmount The amount of perp tokens requested to be burnt.
    // @param maxTranches The maximum amount of tranches to be redeemed.
    // @return burnAmt The amount of perp tokens burnt.
    // @return feeToken The address of the fee token.
    // @return burnFee The fee charged for burning.
    // @return tranches The list of tranches redeemed.
    function previewRedeem(
        IPerpetualTranche perp,
        uint256 requestedAmount,
        uint256 maxTranches
    )
        external
        returns (
            uint256 burnAmt,
            IERC20 feeToken,
            int256 burnFee,
            ITranche[] memory tranches
        )
    {
        uint256 remainder = requestedAmount;

        maxTranches = Math.min(perp.getRedemptionQueueCount(), maxTranches);
        tranches = new ITranche[](maxTranches);
        for (uint256 i = 0; remainder > 0 && i < maxTranches; i++) {
            // NOTE: loops through queue from head to tail
            ITranche t = ITranche(perp.getRedemptionQueueAt(i));
            if (address(t) == address(0)) {
                break;
            }
            (, remainder) = perp.perpsToCoveredTranches(t, remainder);
            tranches[i] = t;
        }

        burnAmt = requestedAmount - remainder;
        feeToken = perp.feeToken();
        burnFee = perp.feeStrategy().computeBurnFee(burnAmt);

        // When the fee is charged in the native token, it's additional
        if (address(feeToken) == address(perp)) {
            burnAmt = (burnAmt.toInt256() + burnFee).abs();
        }

        return (burnAmt, feeToken, burnFee, tranches);
    }

    // @notice Tranches the collateral using the current deposit bond and then deposits individual tranches
    //         to mint perp tokens. It transfers the perp tokens back to the
    //         transaction sender along with, any unused tranches and fees.
    // @param perp Address of the perpetual tranche contract.
    // @param collateralAmount The amount of collateral the user wants to tranche.
    // @param fee The fee paid to the perpetual tranche contract to mint perp.
    // @dev Fee should be pre-computed off-chain using the preview function.
    function trancheAndDeposit(
        IPerpetualTranche perp,
        uint256 collateralAmount,
        uint256 fee
    ) external {
        IBondController bond = perp.getDepositBond();
        TrancheData memory td = bond.getTrancheData();

        IERC20 collateralToken = IERC20(bond.collateralToken());
        IERC20 feeToken = perp.feeToken();

        address self = _self();

        // transfers collateral & fee to router
        collateralToken.safeTransferFrom(msg.sender, self, collateralAmount);
        if (fee > 0) {
            feeToken.safeTransferFrom(msg.sender, self, fee);
        }

        // approves collateral to be tranched tranched
        _checkAndApproveMax(collateralToken, address(bond), collateralAmount);

        // tranches collateral
        bond.deposit(collateralAmount);

        // approves fee to be spent to mint perp tokens
        _checkAndApproveMax(feeToken, address(perp), fee);

        // mints perp tokens using tranches
        for (uint8 i = 0; i < td.trancheCount; i++) {
            uint256 trancheAmt = td.tranches[i].balanceOf(self);
            if (perp.tranchesToPerps(td.tranches[i], trancheAmt) > 0) {
                perp.deposit(td.tranches[i], trancheAmt);
            } else {
                td.tranches[i].safeTransfer(msg.sender, trancheAmt);
            }
        }

        // transfers remaining fee back if overpaid
        uint256 feeBalance = feeToken.balanceOf(self);
        if(feeBalance > 0){
            feeToken.safeTransfer(msg.sender, feeBalance);
        }
        
        // transfers perp tokens back
        uint256 mintAmt = perp.balanceOf(self);
        if(mintAmt > 0){
            perp.safeTransfer(msg.sender, mintAmt);    
        }
    }


    // @notice Redeems perp tokens for tranche tokens until the tranche balance covers it.
    // @param perp Address of the perpetual tranche contract.
    // @param requestedAmount The amount of perp tokens requested to be burnt.
    // @param fee The fee paid for burning.
    // @param requestedTranches The tranches in order to be redeemed.
    // @dev Fee and requestedTranches list are to be pre-computed off-chain using the preview function.
    function redeem(
        IPerpetualTranche perp,
        uint256 requestedAmount,
        uint256 fee,
        ITranche[] memory requestedTranches
    ) external {
        IERC20 feeToken = perp.feeToken();
        uint256 remainder = requestedAmount;

        address self = _self();

        // transfer collateral & fee to router
        perp.safeTransferFrom(msg.sender, self, remainder);
        if (fee > 0) {
            feeToken.safeTransferFrom(msg.sender, self, fee);
        }

        // Approve fees to be spent from router
        _checkAndApproveMax(feeToken, address(perp), fee);

        uint256 trancheCount;
        while (remainder > 0) {
            ITranche t = requestedTranches[trancheCount];

            // When the tranche queue is non empty redeem expects
            //     - requestedTranches[trancheCount] == perp.getBurningTranche()
            // When the tranche queue is empty redeem can happen in any order
            (uint256 burnAmt, ) = perp.redeem(t, remainder);
            remainder -= burnAmt;

            // Transfer redeemed tranches back
            t.safeTransfer(msg.sender, t.balanceOf(self));

            trancheCount++;
        }

        // Transfer any unused fee
        feeToken.safeTransfer(msg.sender, feeToken.balanceOf(self));

        // Transfer remainder perp tokens
        perp.safeTransfer(msg.sender, perp.balanceOf(self));
    }

    // @dev Checks if the spender has sufficient allowance if not approves the maximum possible amount.
    function _checkAndApproveMax(
        IERC20 token,
        address spender,
        uint256 amount
    ) private {
        uint256 allowance = token.allowance(_self(), spender);
        if (allowance < amount) {
            token.approve(spender, type(uint256).max);
        }
    }

    // @dev Alias to self.
    function _self() private view returns (address) {
        return address(this);
    }
}
