import { defineConfig } from "hardhat/config";

/**
 * The series contract and its Solidity tests. Sources in src/, tests in
 * test/. Solidity tests run in the EVM with forge-std cheatcodes; there is
 * no deployment network configured on purpose — nothing here is deployed.
 *
 * The fork tests in test/fork/ read Ethereum through the endpoint named
 * `mainnet` (ETH_RPC_URL, or the public node) and are excluded from the
 * default run because they need the network:
 *
 *   npm test                      # unit tests, no network
 *   npm run test:fork             # the fork tests against Ethereum, latest block
 *
 * A pinned block needs an archive endpoint; public nodes serve recent state
 * only, so the fork tests print the block they ran at instead of pinning one.
 */
export default defineConfig({
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // The fork test builds one JSON record from many locals; via-IR keeps that off the stack.
      viaIR: true,
    },
  },
  paths: {
    sources: "src",
    tests: "test",
  },
  test: {
    solidity: {
      // The fuzz seed is pinned so a recorded run can be repeated exactly;
      // scripts/record-tests.mjs writes the seed, the runs, the results and
      // the commit to evidence/unit-tests.json (blueprint C07).
      fuzz: { seed: "0x7727ea51af0441c20da14dcd68a15dac8c9ebd589c5be8fa8c87c1d3720450bc", runs: 256 },
      // The invariant handler is driven this many sequences deep; the seed above governs both.
      invariant: { runs: 256, depth: 64, failOnRevert: false },
      // The fork tests write what they found to evidence/, nowhere else.
      fsPermissions: { writeFile: ["evidence/apple-s1.fork.json", "evidence/apple-s1.corporate-action.json"] },
      forking: {
        rpcEndpoints: {
          mainnet: process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
        },
      },
    },
  },
});
