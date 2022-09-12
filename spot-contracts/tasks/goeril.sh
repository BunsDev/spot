########################################################################
## DEPLOYMENT

# using staging AMPL instance deployed to: 0x08c5b39F000705ebeC8427C1d64D6262392944EE
# https://github.com/ampleforth/ampleforth-contracts

# using button wood's stating factory deployed to: 0xda5DbE504e7D532E4F8921B38E1F970D4b881BFB
# https://docs.prl.one/buttonwood/developers/deployed-contracts/goerli-testnet

yarn hardhat --network goerli deploy:BondIssuer \
  --bond-factory-address "0xda5DbE504e7D532E4F8921B38E1F970D4b881BFB" \
  --bond-duration "21600" \
  --issue-frequency "3600" \
  --issue-window-offset "0" \
  --collateral-token-address "0x08c5b39F000705ebeC8427C1d64D6262392944EE" \
  --tranche-ratios "[500,500]"

yarn hardhat --network goerli deploy:PerpetualTranche \
  --bond-issuer-address "0x7B5fa02a87CE3DDc56Cf374A3612E23DC6002090" \
  --collateral-token-address "0x08c5b39F000705ebeC8427C1d64D6262392944EE" \
  --name "SPOT" \
  --symbol "SPOT" \
  --pricing-strategy-ref "CDRPricingStrategy"

yarn hardhat --network goerli deploy:DiscountStrategy:setDiscount \
  --discount-strategy-address "0xEDB171C18cE90B633DB442f2A6F72874093b49Ef" \
  --collateral-token-address "0x08c5b39F000705ebeC8427C1d64D6262392944EE" \
  --tranche-ratios "[500,500]" \
  --tranche-index "0" \
  --tranche-discount "1.0"

yarn hardhat --network goerli deploy:Router

## TODO: verify later when repo is public
yarn hardhat verify:contract --network goerli --address 0x7B5fa02a87CE3DDc56Cf374A3612E23DC6002090 --constructor-arguments "[\"0xda5DbE504e7D532E4F8921B38E1F970D4b881BFB\",3600,0,21600,\"0x08c5b39F000705ebeC8427C1d64D6262392944EE\",[500,500]]"
yarn hardhat verify:contract --network goerli --address 0x309Bec44aDe8f113278c68d3a1c21A802Ef69Aee --constructor-arguments "[\"0x6Da15e0ab0524841Ac5e55a77CFC3F5CB040a7B7\",\"0x6Da15e0ab0524841Ac5e55a77CFC3F5CB040a7B7\",\"1000000\",\"1000000\",\"0\"]"
yarn hardhat verify:contract --network goerli --address 0x76bE9bd21d58992316095c0EEAE7d705Bb524A85 --constructor-arguments "[]"
yarn hardhat verify:contract --network goerli --address 0xEDB171C18cE90B633DB442f2A6F72874093b49Ef --constructor-arguments "[]"
yarn hardhat verify:contract --network goerli --address 0x6Da15e0ab0524841Ac5e55a77CFC3F5CB040a7B7 --constructor-arguments "[]"
yarn hardhat verify:contract --network goerli --address 0x8be9cC958680A6b0AE8609150B489a161baD3dCd --constructor-arguments "[]"

########################################################################
## OPS
yarn hardhat --network goerli ops:info 0x6Da15e0ab0524841Ac5e55a77CFC3F5CB040a7B7

yarn hardhat --network goerli ops:updateState 0x6Da15e0ab0524841Ac5e55a77CFC3F5CB040a7B7

yarn hardhat --network goerli ops:trancheAndDeposit \
  --router-address 0x8be9cC958680A6b0AE8609150B489a161baD3dCd \
  --perp-address 0x6Da15e0ab0524841Ac5e55a77CFC3F5CB040a7B7 \
  --collateral-amount 250

yarn hardhat --network goerli ops:redeem \
  --router-address 0x8be9cC958680A6b0AE8609150B489a161baD3dCd \
  --perp-address 0x6Da15e0ab0524841Ac5e55a77CFC3F5CB040a7B7 \
  --amount 10

yarn hardhat --network goerli ops:redeemTranches \
  --bond-issuer-address 0x7B5fa02a87CE3DDc56Cf374A3612E23DC6002090 

yarn hardhat --network goerli ops:trancheAndRollover \
  --router-address 0x8be9cC958680A6b0AE8609150B489a161baD3dCd \
  --perp-address 0x6Da15e0ab0524841Ac5e55a77CFC3F5CB040a7B7 \
  --collateral-amount 200
