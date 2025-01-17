module.exports = {
  env: {
    browser: false,
    es2021: true,
    mocha: true,
    node: true,
  },
  plugins: ["@typescript-eslint"],
  extends: ["standard", "plugin:prettier/recommended", "plugin:node/recommended"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 12,
    warnOnUnsupportedTypeScriptVersion: false,
  },
  rules: {
    "node/no-unsupported-features/es-syntax": ["error", { ignores: ["modules"] }],
    "node/no-missing-import": [
      "error",
      {
        tryExtensions: [".ts", ".js", ".json"],
      },
    ],
    "node/no-unpublished-import": [
      "error",
      {
        allowModules: ["hardhat", "ethers", "@openzeppelin/upgrades-core"],
      },
    ],
  },
};
