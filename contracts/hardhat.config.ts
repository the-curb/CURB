import { defineConfig } from "hardhat/config";

/**
 * The series contract and its Solidity tests. Sources in src/, tests in
 * test/. Solidity tests run in the EVM with forge-std cheatcodes; there is
 * no network configured on purpose — nothing here is deployed.
 */
export default defineConfig({
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "src",
    tests: "test",
  },
});
