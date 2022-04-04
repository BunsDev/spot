import { expect } from "chai";
import { network, ethers } from "hardhat";
import { constants, Contract, Transaction, Signer } from "ethers";

import {
  setupCollateralToken,
  setupBondFactory,
  depositIntoBond,
  bondAt,
  getTranches,
  toFixedPtAmt,
  toYieldFixedPtAmt,
  toPriceFixedPtAmt,
  advancePerpQueue,
} from "./helpers";

let perp: Contract,
  bondFactory: Contract,
  collateralToken: Contract,
  issuer: Contract,
  feeStrategy: Contract,
  pricingStrategy: Contract,
  deployer: Signer,
  deployerAddress: string,
  router:Contract;

describe("RouterV1", function () {
  beforeEach(async function () {
    const accounts = await ethers.getSigners();
    deployer = accounts[0];
    deployerAddress = await deployer.getAddress();

    bondFactory = await setupBondFactory();
    ({ collateralToken } = await setupCollateralToken("Bitcoin", "BTC"));
    const BondIssuer = await ethers.getContractFactory("BondIssuer");
    issuer = await BondIssuer.deploy(bondFactory.address, 1200, 0, 3600, collateralToken.address, [200, 300, 500]);

    const FeeStrategy = await ethers.getContractFactory("MockFeeStrategy");
    feeStrategy = await FeeStrategy.deploy();

    const PricingStrategy = await ethers.getContractFactory("MockPricingStrategy");
    pricingStrategy = await PricingStrategy.deploy();

    const PerpetualTranche = await ethers.getContractFactory("PerpetualTranche");
    perp = await PerpetualTranche.deploy("PerpetualTranche", "PERP", 9);
    await perp.init(issuer.address, feeStrategy.address, pricingStrategy.address);
    await advancePerpQueue(perp, 3600);

    const depositBond = await bondAt(await perp.callStatic.getDepositBond());
    const depositTranches = await getTranches(depositBond);

    await feeStrategy.setFeeToken(perp.address);
    await feeStrategy.setMintFee(toFixedPtAmt("0"));
    await pricingStrategy.setPrice(toPriceFixedPtAmt("1"));
    await perp.updateDefinedYield(await perp.trancheClass(depositTranches[0].address), toYieldFixedPtAmt("1"));
    await perp.updateDefinedYield(await perp.trancheClass(depositTranches[1].address), toYieldFixedPtAmt("0.75"));

    const Router = await ethers.getContractFactory("RouterV1");
    router = await Router.deploy();
  });

  afterEach(async function () {
    await network.provider.send("hardhat_reset");
  });

  describe("#previewTrancheAndDeposit", function(){
    beforeEach(async function(){
      await feeStrategy.setMintFee(toFixedPtAmt('10'))
    })
    describe("when fee token is the native token", async function(){
      it("should compute the mint amount and fee", async function(){
        const r = await router.callStatic.previewTrancheAndDeposit(perp.address, toFixedPtAmt('1000'))
        expect(r[0]).to.eq(toFixedPtAmt('415')) // 200 + (300 * 0.75) - 10
        expect(r[1]).to.eq(perp.address)
        expect(r[2]).to.eq(toFixedPtAmt('10'))
      })
    })

    describe("when fee token is the non-native token", async function(){
      let feeToken: Contract;
      beforeEach(async function () {
        const ERC20 = await ethers.getContractFactory("MockERC20");
        feeToken = await ERC20.deploy("Mock token", "MOCK");
        await feeStrategy.setFeeToken(feeToken.address);
      });

      it("should compute the mint amount and fee", async function(){
        const r = await router.callStatic.previewTrancheAndDeposit(perp.address, toFixedPtAmt('1000'))
        expect(r[0]).to.eq(toFixedPtAmt('425')) // 200 + (300 * 0.75)
        expect(r[1]).to.eq(feeToken.address)
        expect(r[2]).to.eq(toFixedPtAmt('10'))
      })
    })
  })

  describe.only("#previewRedeem", function(){
    let depositTranches1:Contract[],depositTranches2:Contract[],depositTranches3:Contract[]
    beforeEach(async function(){
      await feeStrategy.setBurnFee(toFixedPtAmt('10'))

      const depositBond1 = await bondAt(await perp.callStatic.getDepositBond());
      depositTranches1 = await getTranches(depositBond1);
      await depositIntoBond(depositBond1, toFixedPtAmt("1000"), deployer);
      await depositTranches1[0].approve(perp.address, toFixedPtAmt("200"));
      await perp.deposit(depositTranches1[0].address, toFixedPtAmt("200"));
      await depositTranches1[1].approve(perp.address, toFixedPtAmt("300"));
      await perp.deposit(depositTranches1[1].address, toFixedPtAmt("300"));

      await advancePerpQueue(perp, 1200)

      const depositBond2 = await bondAt(await perp.callStatic.getDepositBond());
      depositTranches2 = await getTranches(depositBond2);
      await depositIntoBond(depositBond2, toFixedPtAmt("1000"), deployer);
      await depositTranches2[0].approve(perp.address, toFixedPtAmt("200"));
      await perp.deposit(depositTranches2[0].address, toFixedPtAmt("200"));
      await depositTranches2[1].approve(perp.address, toFixedPtAmt("300"));
      await perp.deposit(depositTranches2[1].address, toFixedPtAmt("300"));

      await advancePerpQueue(perp, 1200)

      const depositBond3 = await bondAt(await perp.callStatic.getDepositBond());
      depositTranches3 = await getTranches(depositBond3);
      await depositIntoBond(depositBond3, toFixedPtAmt("1000"), deployer);
      await depositTranches3[0].approve(perp.address, toFixedPtAmt("200"));
      await perp.deposit(depositTranches3[0].address, toFixedPtAmt("200"));
      await depositTranches3[1].approve(perp.address, toFixedPtAmt("300"));
      await perp.deposit(depositTranches3[1].address, toFixedPtAmt("300"));
    })

    describe("full redemption", function(){
      it("should compute the burn amount and fee", async function(){
        const r = await router.callStatic.previewRedeem(perp.address, toFixedPtAmt('1275'), constants.MaxUint256)
        expect(r[0]).to.eq(toFixedPtAmt('1285'))
        expect(r[1]).to.eq(perp.address)
        expect(r[2]).to.eq(toFixedPtAmt('10'))
        expect(r[3].length).to.eq(6)
        expect(r[3][0]).to.eq(depositTranches1[0].address)
        expect(r[3][1]).to.eq(depositTranches1[1].address)
        expect(r[3][2]).to.eq(depositTranches2[0].address)
        expect(r[3][3]).to.eq(depositTranches2[1].address)
        expect(r[3][4]).to.eq(depositTranches3[0].address)
        expect(r[3][5]).to.eq(depositTranches3[1].address)
      })
    })

    describe('full redemption when max tranches is set', async function(){
      it("should compute the burn amount and fee", async function(){
        const r = await router.callStatic.previewRedeem(perp.address, toFixedPtAmt('1275'), 2)
        expect(r[0]).to.eq(toFixedPtAmt('435'))
        expect(r[1]).to.eq(perp.address)
        expect(r[2]).to.eq(toFixedPtAmt('10'))
        expect(r[3].length).to.eq(2)
        expect(r[3][0]).to.eq(depositTranches1[0].address)
        expect(r[3][1]).to.eq(depositTranches1[1].address)
      })
    })

    describe('partial redemption', async function(){
      it("should compute the burn amount and fee", async function(){
        const r = await router.callStatic.previewRedeem(perp.address, toFixedPtAmt('500'), constants.MaxUint256)
        expect(r[0]).to.eq(toFixedPtAmt('510'))
        expect(r[1]).to.eq(perp.address)
        expect(r[2]).to.eq(toFixedPtAmt('10'))
        expect(r[3].length).to.eq(6)
        expect(r[3][0]).to.eq(depositTranches1[0].address)
        expect(r[3][1]).to.eq(depositTranches1[1].address)
        expect(r[3][2]).to.eq(depositTranches2[0].address)
        expect(r[3][3]).to.eq(constants.AddressZero)
        expect(r[3][4]).to.eq(constants.AddressZero)
        expect(r[3][5]).to.eq(constants.AddressZero)
      })
    })

    describe('when fee is in non native token', async function(){
      let feeToken: Contract;
      beforeEach(async function () {
        const ERC20 = await ethers.getContractFactory("MockERC20");
        feeToken = await ERC20.deploy("Mock token", "MOCK");
        await feeStrategy.setFeeToken(feeToken.address);
      });

       it("should compute the burn amount and fee", async function(){
        const r = await router.callStatic.previewRedeem(perp.address, toFixedPtAmt('500'), constants.MaxUint256)
        expect(r[0]).to.eq(toFixedPtAmt('500'))
        expect(r[1]).to.eq(feeToken.address)
        expect(r[2]).to.eq(toFixedPtAmt('10'))
        expect(r[3].length).to.eq(6)
        expect(r[3][0]).to.eq(depositTranches1[0].address)
        expect(r[3][1]).to.eq(depositTranches1[1].address)
        expect(r[3][2]).to.eq(depositTranches2[0].address)
        expect(r[3][3]).to.eq(constants.AddressZero)
        expect(r[3][4]).to.eq(constants.AddressZero)
        expect(r[3][5]).to.eq(constants.AddressZero)
      })
    })
  });
});
