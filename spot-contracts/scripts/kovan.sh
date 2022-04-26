yarn hardhat --network kovan deploy:BondFactory

yarn hardhat --network kovan deploy:BondIssuer \
  --bond-factory-address "0x649535d71D381D666a3D6577d647D1886C42cAE5" \
  --issue-frequency "3600" \
  --issue-window-offset "0" \
  --bond-duration "21600" \
  --collateral-token-address "0x3E0437898a5667a4769B1Ca5A34aAB1ae7E81377" \
  --tranche-ratios "[500,500]"

yarn hardhat --network kovan deploy:PerpetualTranche \
  --bond-issuer-address "0xE5C13BbF1b675359Ff4bc44df46BE842a69d9480" \
  --name "Perpetual Safe AMPL" \
  --symbol "safeAMPL" \
  --decimals 9

yarn hardhat --network kovan deploy:PerpetualTranche:setYield \
  --perp-address "0x643B56F96DaD4eACd69a59E9F5801f227BA461e6" \
  --collateral-token-address "0x3E0437898a5667a4769B1Ca5A34aAB1ae7E81377" \
  --tranche-ratios "[500,500]" \
  --tranche-index "0" \
  --tranche-yield "1.0"

yarn hardhat --network kovan deploy:Router

yarn hardhat --network kovan ops:info 0x643B56F96DaD4eACd69a59E9F5801f227BA461e6

yarn hardhat --network kovan ops:trancheAndDeposit \
  --perp-address 0x643B56F96DaD4eACd69a59E9F5801f227BA461e6 \
  --router-address 0xbe800FB5ea2Ab4356E08612B7423e6F1618488fd \
  --collateral-amount 250

yarn hardhat --network kovan ops:redeem \
  --perp-address 0x643B56F96DaD4eACd69a59E9F5801f227BA461e6 \
  --router-address 0xbe800FB5ea2Ab4356E08612B7423e6F1618488fd \
  --amount 1

yarn hardhat --network kovan ops:redeemIcebox \
  --perp-address 0x643B56F96DaD4eACd69a59E9F5801f227BA461e6 \
  --router-address 0xbe800FB5ea2Ab4356E08612B7423e6F1618488fd \
  --amount 1

yarn hardhat --network kovan ops:redeemTranches \
  --bond-issuer-address 0xE5C13BbF1b675359Ff4bc44df46BE842a69d9480 

yarn hardhat --network kovan ops:trancheAndRollover \
  --perp-address 0x643B56F96DaD4eACd69a59E9F5801f227BA461e6 \
  --router-address 0xbe800FB5ea2Ab4356E08612B7423e6F1618488fd \
  --collateral-amount 2000