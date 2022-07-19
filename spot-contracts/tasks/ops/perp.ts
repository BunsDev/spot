import { task, types } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { BigNumber, utils, constants, Contract } from "ethers";

task("ops:info")
  .addPositionalParam("perpAddress", "the address of the perp contract", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { perpAddress } = args;

    const perp = await hre.ethers.getContractAt("PerpetualTranche", perpAddress);
    const perpDecimals = await perp.decimals();

    const bondIssuer = await hre.ethers.getContractAt("BondIssuer", await perp.bondIssuer());
    const latestBond = await hre.ethers.getContractAt("IBondController", await bondIssuer.callStatic.getLatestBond());

    const collateralToken = await hre.ethers.getContractAt("MockERC20", await perp.collateral());
    const feeStrategy = await hre.ethers.getContractAt("BasicFeeStrategy", await perp.feeStrategy());
    const pricingStrategy = await hre.ethers.getContractAt("CDRPricingStrategy", await perp.pricingStrategy());
    const yieldStrategy = await hre.ethers.getContractAt("TrancheClassYieldStrategy", await perp.yieldStrategy());
    const depositBond = await hre.ethers.getContractAt("IBondController", await perp.callStatic.getDepositBond());
    const issued = (await hre.ethers.provider.getCode(depositBond.address)) !== "0x";

    console.log("---------------------------------------------------------------");
    console.log("BondIssuer:", bondIssuer.address);
    console.log("latestBond:", latestBond.address);

    console.log("---------------------------------------------------------------");
    console.log("PerpetualTranche:", perp.address);
    console.log("reserve:", await perp.reserve());
    console.log("collateralToken", collateralToken.address);
    console.log("feeStrategy:", feeStrategy.address);
    console.log("yieldStrategy:", yieldStrategy.address);
    console.log("feeToken:", await feeStrategy.feeToken());
    console.log("pricingStrategy:", pricingStrategy.address);
    console.log(`maturityTolarance: [${await perp.minTrancheMaturitySec()}, ${await perp.maxTrancheMaturitySec()}]`);
    console.log("depositBond:", depositBond.address);
    console.log("issued:", issued);
    console.log("TotalSupply:", utils.formatUnits(await perp.totalSupply(), perpDecimals));

    const trancheBalances = await perp.callStatic.getStdTrancheBalances();
    console.log("TotalStdTrancheBalance:", utils.formatUnits(trancheBalances[0], perpDecimals));
    console.log("MatureStdTrancheBalance:", utils.formatUnits(trancheBalances[0], perpDecimals));

    console.log("---------------------------------------------------------------");
    console.log("Reserve:");
    const reserveCount = (await perp.callStatic.getReserveCount()).toNumber();
    console.log("reserveCount:", reserveCount);

    const upForRollover = await perp.callStatic.getReserveTokensUpForRollover();
    const reserveValue = await perp.callStatic.getReserveValue();
    console.log("reserveValue:", utils.formatUnits(reserveValue, perpDecimals + (await pricingStrategy.decimals())));
    console.log("token\tbalance\tyield\tprice\tupForRollover");
    for (let i = 0; i < reserveCount; i++) {
      const tokenAddress = await perp.callStatic.getReserveAt(i);
      const balance = await perp.callStatic.getReserveTrancheBalance(tokenAddress);
      const yieldF = await perp.computeYield(tokenAddress);
      const price = await perp.computePrice(tokenAddress);
      console.log(
        `reserve(${i}):${tokenAddress}`,
        `\t${utils.formatUnits(balance, await perp.decimals())}`,
        `\t${utils.formatUnits(yieldF, await yieldStrategy.decimals())}`,
        `\t${utils.formatUnits(price, await pricingStrategy.decimals())}`,
        `\t${upForRollover[i] !== constants.AddressZero && balance.gt(0)}`,
      );
    }
    console.log("---------------------------------------------------------------");
  });

task("ops:trancheAndDeposit")
  .addParam("perpAddress", "the address of the perp contract", undefined, types.string, false)
  .addParam("routerAddress", "the address of the router contract", undefined, types.string, false)
  .addParam(
    "collateralAmount",
    "the total amount of collateral (in float) to tranche and deposit to mint perps",
    undefined,
    types.string,
    false,
  )
  .addOptionalParam("from", "the address of sender", "0x", types.string)
  .setAction(async function (args: TaskArguments, hre) {
    const { perpAddress, routerAddress, collateralAmount } = args;

    const router = await hre.ethers.getContractAt("RouterV1", routerAddress);
    const perp = await hre.ethers.getContractAt("PerpetualTranche", perpAddress);
    const bondIssuer = await hre.ethers.getContractAt("BondIssuer", await perp.bondIssuer());
    const collateralToken = await hre.ethers.getContractAt("MockERC20", await bondIssuer.collateralToken());

    const fixedPtCollateralAmount = utils.parseUnits(collateralAmount, await collateralToken.decimals());
    const [depositBondAddress, trancheAddresses, trancheAmts] = await router.callStatic.previewTranche(
      perp.address,
      fixedPtCollateralAmount,
    );

    console.log("---------------------------------------------------------------");
    console.log("Preview tranche:", collateralAmount);
    for (let i = 0; i < trancheAddresses.length; i++) {
      console.log(
        `tranches(${i}):`,
        trancheAddresses[i],
        utils.formatUnits(trancheAmts[i].toString(), await collateralToken.decimals()),
      );
    }

    console.log("---------------------------------------------------------------");
    console.log("Preview mint:", collateralAmount);
    const feeToken = await hre.ethers.getContractAt("PerpetualTranche", await perp.feeToken());
    let totalMintFee = BigNumber.from("0");
    let totalMintAmt = BigNumber.from("0");
    for (let i = 0; i < trancheAddresses.length; i++) {
      const [mintAmt, , mintFee] = await router.callStatic.previewDeposit(
        perp.address,
        trancheAddresses[i],
        trancheAmts[i],
      );
      totalMintAmt = totalMintAmt.add(mintAmt);
      totalMintFee = totalMintFee.add(mintFee);
    }
    console.log("mintAmt", utils.formatUnits(totalMintAmt, await perp.decimals()));
    console.log("mintFee", utils.formatUnits(totalMintFee, await feeToken.decimals()));

    if (totalMintAmt.eq("0")) {
      throw Error("No perp minted");
    }

    console.log("---------------------------------------------------------------");
    console.log("Execution:");
    let deployerAddress = args.from;
    if (deployerAddress === "0x") {
      deployerAddress = await (await hre.ethers.getSigners())[0].getAddress();
    }
    console.log("Signer", deployerAddress);

    console.log("Approving router to spend tokens:");
    const tx1 = await collateralToken.approve(router.address, fixedPtCollateralAmount);
    await tx1.wait();
    console.log("Tx", tx1.hash);

    let fee = BigNumber.from("0");
    if (totalMintFee.gt("0") && feeToken.address !== perp.address) {
      fee = totalMintFee;
      console.log("Approving fees to be spent:");
      const tx2 = await feeToken.increaseAllowance(router.address, fee);
      await tx2.wait();
      console.log("Tx", tx2.hash);
    }

    console.log("Tranche and deposit:");
    const tx3 = await router.trancheAndDeposit(perp.address, depositBondAddress, fixedPtCollateralAmount, fee);
    await tx3.wait();
    console.log("Tx", tx3.hash);

    console.log("Signer balance", utils.formatUnits(await perp.balanceOf(deployerAddress), await perp.decimals()));
  });

task("ops:redeem")
  .addParam("perpAddress", "the address of the perp contract", undefined, types.string, false)
  .addParam("routerAddress", "the address of the router contract", undefined, types.string, false)
  .addParam("amount", "the total amount of perp tokens (in float) to redeem", undefined, types.string, false)
  .addOptionalParam("from", "the address of sender", "0x", types.string)
  .setAction(async function (args: TaskArguments, hre) {
    const { perpAddress, routerAddress, amount } = args;

    const router = await hre.ethers.getContractAt("RouterV1", routerAddress);
    const perp = await hre.ethers.getContractAt("PerpetualTranche", perpAddress);
    const feeToken = await hre.ethers.getContractAt("PerpetualTranche", await perp.feeToken());
    const fixedPtAmount = utils.parseUnits(amount, await perp.decimals());

    console.log("---------------------------------------------------------------");
    console.log("Preview redeem:", amount);
    const [reserveTokens, , , burnFee] = await router.callStatic.previewRedeem(perp.address, fixedPtAmount);
    console.log("burnAmt", amount);
    console.log("burnFee", utils.formatUnits(burnFee, await feeToken.decimals()));
    console.log("reserve token redeemed");
    for (let i = 0; i < reserveTokens.length; i++) {
      console.log(`reserve(${i}):`, reserveTokens[i]);
    }

    console.log("---------------------------------------------------------------");
    console.log("Execution:");
    let deployerAddress = args.from;
    if (deployerAddress === "0x") {
      deployerAddress = await (await hre.ethers.getSigners())[0].getAddress();
    }
    console.log("Signer", deployerAddress);

    console.log("Approving router to spend tokens:");
    if ((await perp.allowance(deployerAddress, router.address)).lt(fixedPtAmount)) {
      const tx1 = await perp.approve(router.address, fixedPtAmount);
      await tx1.wait();
      console.log("Tx", tx1.hash);
    }

    let fee = BigNumber.from("0");
    if (burnFee.gt("0")) {
      fee = burnFee;
      console.log("Approving fees to be spent:");
      const tx2 = await feeToken.increaseAllowance(router.address, fee);
      await tx2.wait();
      console.log("Tx", tx2.hash);
    }

    console.log("Redeem:");
    const tx3 = await perp.burn(fixedPtAmount);
    await tx3.wait();
    console.log("Tx", tx3.hash);

    console.log("Signer balance", utils.formatUnits(await perp.balanceOf(deployerAddress), await perp.decimals()));
  });

task("ops:redeemTranches")
  .addParam("bondIssuerAddress", "the address of the bond issuer contract", undefined, types.string, false)
  .addOptionalParam("from", "the address of sender", "0x", types.string)
  .setAction(async function (args: TaskArguments, hre) {
    const { bondIssuerAddress } = args;
    const bondIssuer = await hre.ethers.getContractAt("BondIssuer", bondIssuerAddress);

    const attemptMature = async (bond: Contract) => {
      try {
        console.log("Invoking Mature");
        const tx = await bond.mature();
        await tx.wait();
        console.log("Tx:", tx.hash);
      } catch (e) {
        console.log("Not up for maturity");
      }
    };

    console.log("---------------------------------------------------------------");
    console.log("Execution:");
    let deployerAddress = args.from;
    if (deployerAddress === "0x") {
      deployerAddress = await (await hre.ethers.getSigners())[0].getAddress();
    }
    console.log("Signer", deployerAddress);

    // iterate through the bonds
    const issuedCount = await bondIssuer.callStatic.issuedCount();
    for (let i = 0; i < issuedCount; i++) {
      const bondAddress = await bondIssuer.callStatic.issuedBondAt(i);
      const bond = await hre.ethers.getContractAt("IBondController", bondAddress);

      console.log("---------------------------------------------------------------");
      console.log("Processing bond", bondAddress);

      const trancheCount = await bond.trancheCount();
      const tranches = [];
      for (let j = 0; j < trancheCount; j++) {
        const [address, ratio] = await bond.tranches(j);
        const tranche = await hre.ethers.getContractAt("ITranche", address);
        const balance = await tranche.balanceOf(deployerAddress);
        const scalar = balance.div(ratio).mul("1000");
        tranches.push({
          idx: j,
          address,
          tranche,
          ratio,
          balance,
          scalar,
        });
      }

      await attemptMature(bond);

      if (!(await bond.isMature())) {
        console.log("Redeeming based on balance");
        const minScalarTranche = tranches.sort((a, b) =>
          a.scalar.gte(b.scalar) ? (a.scalar.eq(b.scalar) ? 0 : 1) : -1,
        )[0];
        if (minScalarTranche.scalar.gt("0")) {
          const redemptionAmounts = tranches.map(t => t.ratio.mul(minScalarTranche.scalar).div("1000"));
          console.log(
            "Tranche balances",
            tranches.map(t => t.balance),
          );
          console.log("Redeeming tranches", redemptionAmounts);
          const tx = await bond.redeem(redemptionAmounts);
          await tx.wait();
          console.log("Tx:", tx.hash);
        }
      } else {
        console.log("Redeeming mature");
        for (let j = 0; j < trancheCount; j++) {
          if (tranches[j].balance.gt(0)) {
            console.log("Redeeming", tranches[j].address);
            const tx = await bond.redeemMature(tranches[j].address, tranches[j].balance);
            await tx.wait();
            console.log("Tx:", tx.hash);
          }
        }
      }
    }
  });

task("ops:trancheAndRollover")
  .addParam("perpAddress", "the address of the perp contract", undefined, types.string, false)
  .addParam("routerAddress", "the address of the router contract", undefined, types.string, false)
  .addParam(
    "collateralAmount",
    "the total amount of collateral (in float) to tranche and use for rolling over",
    undefined,
    types.string,
    false,
  )
  .addOptionalParam("from", "the address of sender", "0x", types.string)
  .setAction(async function (args: TaskArguments, hre) {
    const { perpAddress, routerAddress, collateralAmount } = args;

    const router = await hre.ethers.getContractAt("RouterV1", routerAddress);
    const perp = await hre.ethers.getContractAt("PerpetualTranche", perpAddress);
    const bondIssuer = await hre.ethers.getContractAt("BondIssuer", await perp.bondIssuer());
    const collateralToken = await hre.ethers.getContractAt("MockERC20", await bondIssuer.collateralToken());

    const fixedPtCollateralAmount = utils.parseUnits(collateralAmount, await collateralToken.decimals());
    const [depositBondAddress, trancheAddresses, depositTrancheAmts] = await router.callStatic.previewTranche(
      perp.address,
      fixedPtCollateralAmount,
    );
    const depositBond = await hre.ethers.getContractAt("IBondController", depositBondAddress);

    console.log("---------------------------------------------------------------");
    console.log("Preview tranche:", collateralAmount);
    const depositTranches = [];
    for (let i = 0; i < trancheAddresses.length; i++) {
      const tranche = await hre.ethers.getContractAt("ITranche", trancheAddresses[i]);
      depositTranches.push(tranche);
      console.log(
        `tranches(${i}):`,
        trancheAddresses[i],
        utils.formatUnits(depositTrancheAmts[i].toString(), await collateralToken.decimals()),
      );
    }

    console.log("---------------------------------------------------------------");
    console.log("Rollover list:");
    const reserveCount = (await perp.callStatic.getReserveCount()).toNumber();
    const upForRotation = await perp.callStatic.getReserveTokensUpForRollover();
    const reserveTokens = [];
    const reserveTokenBalances = [];
    const rotationTokens = [];
    const rotationTokenBalances = [];
    for (let i = 0; i < reserveCount; i++) {
      const tranche = await hre.ethers.getContractAt("ITranche", await perp.callStatic.getReserveAt(i));
      const balance = await perp.callStatic.getReserveTrancheBalance(tranche.address);
      reserveTokens.push(tranche);
      reserveTokenBalances.push(balance);
      if (upForRotation[i] !== constants.AddressZero && balance.gt(0)) {
        rotationTokens.push(tranche);
        rotationTokenBalances.push(balance);
      }
    }
    if (rotationTokens.length === 0) {
      throw Error("No tokens up for rollover");
    }

    console.log("---------------------------------------------------------------");
    console.log("Rollover preview:");
    const feeToken = await hre.ethers.getContractAt("PerpetualTranche", await perp.feeToken());
    let totalRolloverAmt = BigNumber.from("0");
    let totalRolloverFee = BigNumber.from("0");

    const remainingTrancheInAmts: BigNumber[] = depositTrancheAmts.map((t: BigNumber) => t);
    const remainingTokenOutAmts: BigNumber[] = rotationTokenBalances.map(b => b);

    const rolloverData: any[] = [];
    for (let i = 0, j = 0; i < depositTranches.length && j < rotationTokens.length; ) {
      const trancheIn = depositTranches[i];
      const tokenOut = rotationTokens[j];
      const [rd, , rolloverFee] = await router.callStatic.previewRollover(
        perp.address,
        trancheIn.address,
        tokenOut.address,
        remainingTrancheInAmts[i],
        remainingTokenOutAmts[j],
      );

      if (rd.perpRolloverAmt.gt("0")) {
        rolloverData.push({
          trancheIn: trancheIn,
          tokenOut: tokenOut,
          trancheInAmt: rd.trancheInAmt,
          tokenOutAmt: rd.tokenOutAmt,
        });

        totalRolloverAmt = totalRolloverAmt.add(rd.perpRolloverAmt);
        totalRolloverFee = totalRolloverFee.add(rolloverFee);

        remainingTrancheInAmts[i] = rd.remainingTrancheInAmt;
        remainingTokenOutAmts[j] = remainingTokenOutAmts[j].sub(rd.tokenOutAmt);

        if (remainingTrancheInAmts[i].eq("0")) {
          i++;
        }
        if (remainingTokenOutAmts[j].eq("0")) {
          j++;
        }
      } else {
        i++;
      }
    }
    console.log("rolloverAmt", utils.formatUnits(totalRolloverAmt, await perp.decimals()));
    console.log("rolloverFee", utils.formatUnits(totalRolloverFee, await feeToken.decimals()));

    console.log("---------------------------------------------------------------");
    console.log("Execution:");
    let deployerAddress = args.from;
    if (deployerAddress === "0x") {
      deployerAddress = await (await hre.ethers.getSigners())[0].getAddress();
    }
    console.log("Signer", deployerAddress);

    console.log("Approving collateralToken to be spent");
    const tx1 = await collateralToken.approve(router.address, fixedPtCollateralAmount);
    await tx1.wait();
    console.log("Tx", tx1.hash);

    let fee = BigNumber.from("0");
    if (totalRolloverFee.gt("0")) {
      fee = totalRolloverFee;
      console.log("Approving fees to be spent:");
      const tx2 = await feeToken.increaseAllowance(router.address, fee);
      await tx2.wait();
      console.log("Tx", tx2.hash);
    }

    // TODO: fee calculation has some rounding issues. Overpaying fixes it for now
    fee = fee.mul("2");

    console.log("Executing rollover:");
    console.log(rolloverData.map(r => [r.trancheIn.address, r.tokenOut.address, r.trancheInAmt]));
    const tx3 = await router.trancheAndRollover(
      perp.address,
      depositBond.address,
      fixedPtCollateralAmount,
      rolloverData.map(r => [r.trancheIn.address, r.tokenOut.address, r.trancheInAmt]),
      fee,
    );
    await tx3.wait();
    console.log("Tx", tx3.hash);
  });
