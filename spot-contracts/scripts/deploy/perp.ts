import { task, types } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

task("deploy:BondIssuer")
  .addParam("bondFactoryAddress", "the address of the band factory", undefined, types.string, false)
  .addParam("issueFrequency", "time between issues", undefined, types.int, false)
  .addParam("issueWindowOffset", "clock alignment for window opening", undefined, types.int, false)
  .addParam("bondDuration", "length of the bonds", undefined, types.int, false)
  .addParam("collateralTokenAddress", "address of the collateral token", undefined, types.string, false)
  .addParam("trancheRatios", "list of tranche ratios", undefined, types.json, false)
  .setAction(async function (args: TaskArguments, hre) {
    const {
      bondFactoryAddress,
      issueFrequency,
      issueWindowOffset,
      bondDuration,
      collateralTokenAddress,
      trancheRatios,
    } = args;
    console.log("Signer", await (await hre.ethers.getSigners())[0].getAddress());

    const BondIssuer = await hre.ethers.getContractFactory("BondIssuer");
    const bondIssuer = await BondIssuer.deploy(
      bondFactoryAddress,
      issueFrequency,
      issueWindowOffset,
      bondDuration,
      collateralTokenAddress,
      trancheRatios,
    );

    await bondIssuer.deployed();

    await bondIssuer.issue();

    await hre.run("verify:contract", {
      address: bondIssuer.address,
      constructorArguments: [
        bondFactoryAddress,
        issueFrequency,
        issueWindowOffset,
        bondDuration,
        collateralTokenAddress,
        trancheRatios,
      ],
    });

    console.log("Bond issuer implementation", bondIssuer.address);
  });

task("deploy:PerpetualTranche")
  .addParam("bondIssuerAddress", "the address of the bond issuer", undefined, types.string, false)
  .addParam("name", "the ERC20 name", undefined, types.string, false)
  .addParam("symbol", "the ERC20 symbol", undefined, types.string, false)
  .addParam("decimals", "the number of decimals", undefined, types.int, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { bondIssuerAddress, name, symbol, decimals } = args;
    console.log("Signer", await (await hre.ethers.getSigners())[0].getAddress());

    const PerpetualTranche = await hre.ethers.getContractFactory("PerpetualTranche");
    const perp = await PerpetualTranche.deploy(name, symbol, decimals);
    await perp.deployed();

    const BasicFeeStrategy = await hre.ethers.getContractFactory("BasicFeeStrategy");
    const feeStrategy = await BasicFeeStrategy.deploy(perp.address, perp.address, "10000", "10000", "-10000");
    await feeStrategy.deployed();

    const UnitPricingStrategy = await hre.ethers.getContractFactory("UnitPricingStrategy");
    const pricingStrategy = await UnitPricingStrategy.deploy();
    await pricingStrategy.deployed();

    await perp.init(bondIssuerAddress, feeStrategy.address, pricingStrategy.address);
    await perp.updateTolerableTrancheMaturiy("1", "86400");

    console.log("perp", perp.address);
    console.log("feeStrategy", feeStrategy.address);
    console.log("pricingStrategy", pricingStrategy.address);

    await hre.run("verify:contract", {
      address: feeStrategy.address,
      constructorArguments: [perp.address, perp.address, "10000", "10000", "-10000"],
    });

    await hre.run("verify:contract", {
      address: pricingStrategy.address,
    });

    await hre.run("verify:contract", {
      address: perp.address,
      constructorArguments: [name, symbol, decimals],
    });
  });

task("deploy:PerpetualTranche:setYield")
  .addParam("perpAddress", "the address of the perp contract", undefined, types.string, false)
  .addParam("collateralTokenAddress", "the address of the collateral token", undefined, types.string, false)
  .addParam("trancheRatios", "the bond's tranche ratios", undefined, types.json, false)
  .addParam("trancheIndex", "the tranche's index", undefined, types.string, false)
  .addParam("trancheYield", "the yields to be set in float", undefined, types.string, false)
  .setAction(async function (args: TaskArguments, hre) {
    const { perpAddress, collateralTokenAddress, trancheRatios, trancheIndex, trancheYield } = args;
    const perp = await hre.ethers.getContractAt("PerpetualTranche", perpAddress);
    const abiCoder = new hre.ethers.utils.AbiCoder();
    const hash = hre.ethers.utils.keccak256(
      abiCoder.encode(["address", "uint256[]", "uint256"], [collateralTokenAddress, trancheRatios, trancheIndex]),
    );
    const tx = await perp.updateDefinedYield(
      hash,
      hre.ethers.utils.parseUnits(trancheYield, await perp.YIELD_DECIMALS()),
    );
    console.log(tx.hash);
    await tx.wait();
  });

task("deploy:Router").setAction(async function (args: TaskArguments, hre) {
  console.log("Signer", await (await hre.ethers.getSigners())[0].getAddress());

  const RouterV1 = await hre.ethers.getContractFactory("RouterV1");
  const router = await RouterV1.deploy();
  await router.deployed();

  console.log("router", router.address);
  await hre.run("verify:contract", {
    address: router.address,
  });
});

// TODO: comes later
// yarn hardhat --network kovan deploy:RolloverVault \
//   --perp "0x18553d37cDA8853Bc8e3D99F01F41E0d12678441" \
//   --underlying "0x3E0437898a5667a4769B1Ca5A34aAB1ae7E81377" \
//   --name "Rollover Vault AMPL" \
//   --symbol "vAMPL"
//
// task("deploy:RolloverVault")
//   .addParam("perp", "the address of the perp contract", undefined, types.string, false)
//   .addParam("underlying", "the address of the underlying asset", undefined, types.string, false)
//   .addParam("name", "the ERC20 name of the vault token", undefined, types.string, false)
//   .addParam("symbol", "the ERC20 symbol of the vault token", undefined, types.string, false)
//   .addParam("initialRate", "the initial exchange rate", "100000", types.string, true)
//   .setAction(async function (args: TaskArguments, hre) {
//     const { perp, underlying, name, symbol, initialRate } = args;
//     console.log("Signer", await (await hre.ethers.getSigners())[0].getAddress());

//     const RolloverVault = await hre.ethers.getContractFactory("RolloverVault");
//     const constructorArguments = [perp, underlying, name, symbol];
//     const vault = await RolloverVault.deploy(...constructorArguments);

//     await vault.deployed();

//     const token = await hre.ethers.getContractAt("IERC20", underlying);
//     await token.approve(vault.address, vault.INITIAL_DEPOSIT());

//     await vault.init(initialRate, "20000", "7200");

//     console.log("rolloverVault", vault.address);

//     await hre.run("verify:contract", {
//       address: vault.address,
//       constructorArguments: constructorArguments,
//     });
//   });
