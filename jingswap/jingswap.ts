#!/usr/bin/env bun
/**
 * Jingswap skill CLI
 * Blind batch auction for STX/sBTC on Stacks
 *
 * Usage: bun run jingswap/jingswap.ts <subcommand> [options]
 */

import { Command } from "commander";
import {
  uintCV,
  bufferCV,
  contractPrincipalCV,
  PostConditionMode,
  Pc,
} from "@stacks/transactions";
import { getAccount, getWalletAddress } from "../src/lib/services/x402.service.js";
import { NETWORK, getExplorerTxUrl } from "../src/lib/config/networks.js";
import { callContract } from "../src/lib/transactions/builder.js";
import { printJson, handleError } from "../src/lib/utils/cli.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JINGSWAP_API =
  process.env.JINGSWAP_API_URL || "https://faktory-dao-backend.vercel.app";
const JINGSWAP_API_KEY =
  process.env.JINGSWAP_API_KEY ||
  "jc_b058d7f2e0976bd4ee34be3e5c7ba7ebe45289c55d3f5e45f666ebc14b7ebfd0";

const CONTRACT_ADDRESS = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const CONTRACT_NAME = "sbtc-stx-jingswap";
const SBTC_CONTRACT =
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token" as `${string}.${string}`;

const PYTH_CONTRACTS = {
  storage: { address: "SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y", name: "pyth-storage-v4" },
  decoder: { address: "SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y", name: "pyth-pnau-decoder-v3" },
  wormhole: { address: "SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y", name: "wormhole-core-v2" },
};

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

async function jingswapGet(path: string): Promise<any> {
  const res = await fetch(`${JINGSWAP_API}${path}`, {
    headers: { "x-api-key": JINGSWAP_API_KEY },
  });
  if (!res.ok)
    throw new Error(`Jingswap API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "API returned failure");
  return json.data;
}

async function assertDepositPhase(): Promise<any> {
  const data = await jingswapGet("/api/auction/cycle-state");
  if (data.phase !== 0) {
    const phases = ["deposit", "buffer", "settle"];
    throw new Error(
      `Cannot deposit/cancel — auction is in ${phases[data.phase] || "unknown"} phase (must be deposit)`
    );
  }
  return data;
}

async function assertNotDepositPhase(): Promise<any> {
  const data = await jingswapGet("/api/auction/cycle-state");
  if (data.phase === 0) {
    throw new Error("Cannot settle/cancel-cycle — auction is still in deposit phase");
  }
  return data;
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("jingswap")
  .description(
    "Jingswap blind batch auction — deposit/cancel STX and sBTC, " +
      "close deposits, settle with oracle prices, query cycle state and history."
  )
  .version("0.1.0");

// ---------------------------------------------------------------------------
// Read commands
// ---------------------------------------------------------------------------

program
  .command("cycle-state")
  .description("Get current auction cycle state (phase, blocks, totals, minimums)")
  .action(async () => {
    try {
      const data = await jingswapGet("/api/auction/cycle-state");
      printJson({
        ...data,
        _hint: {
          phases: "0=deposit (min 150 blocks ~5min), 1=buffer (~1min), 2=settle",
          blockTime: "~2 seconds per Stacks block (Nakamoto)",
        },
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("depositors")
  .description("Get STX and sBTC depositors for a cycle")
  .requiredOption("--cycle <number>", "Cycle number")
  .action(async (opts: { cycle: string }) => {
    try {
      const data = await jingswapGet(`/api/auction/depositors/${opts.cycle}`);
      printJson(data);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("user-deposit")
  .description("Get a user's deposit amounts for a cycle")
  .requiredOption("--cycle <number>", "Cycle number")
  .requiredOption("--address <stx_address>", "Stacks address")
  .action(async (opts: { cycle: string; address: string }) => {
    try {
      const data = await jingswapGet(
        `/api/auction/deposit/${opts.cycle}/${opts.address}`
      );
      printJson(data);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("settlement")
  .description("Get settlement details for a completed cycle")
  .requiredOption("--cycle <number>", "Cycle number")
  .action(async (opts: { cycle: string }) => {
    try {
      const data = await jingswapGet(`/api/auction/settlement/${opts.cycle}`);
      printJson(data);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("cycles-history")
  .description("Get full history of all auction cycles")
  .action(async () => {
    try {
      const data = await jingswapGet("/api/auction/cycles-history");
      printJson(data);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("user-activity")
  .description("Get a user's auction activity (deposits, cancellations, fills)")
  .requiredOption("--address <stx_address>", "Stacks address")
  .action(async (opts: { address: string }) => {
    try {
      const data = await jingswapGet(`/api/auction/activity/${opts.address}`);
      printJson({
        ...data,
        _hint: {
          "distribute-stx-depositor":
            "stxAmount = unswapped STX rolled to next cycle, sbtcAmount = sBTC received",
          "distribute-sbtc-depositor":
            "sbtcAmount = unswapped sats rolled to next cycle, stxAmount = STX received",
        },
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("prices")
  .description("Get oracle and DEX prices (Pyth, XYK, DLMM)")
  .action(async () => {
    try {
      const [pyth, dex] = await Promise.all([
        jingswapGet("/api/auction/pyth-prices"),
        jingswapGet("/api/auction/dex-price"),
      ]);
      const xykStxPerBtc =
        dex.xykBalances && dex.xykBalances.xBalance > 0
          ? (dex.xykBalances.yBalance / dex.xykBalances.xBalance / 1e6) * 1e8
          : null;
      const dlmmStxPerBtc =
        dex.dlmmPrice && dex.dlmmPrice > 0
          ? 1 / (dex.dlmmPrice * 1e-10)
          : null;
      printJson({
        pyth,
        dex: {
          ...dex,
          xykStxPerBtc: xykStxPerBtc ? Math.round(xykStxPerBtc * 100) / 100 : null,
          dlmmStxPerBtc: dlmmStxPerBtc ? Math.round(dlmmStxPerBtc * 100) / 100 : null,
        },
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// Write commands — deposit phase
// ---------------------------------------------------------------------------

program
  .command("deposit-stx")
  .description("Deposit STX into current auction cycle (deposit phase only)")
  .requiredOption("--amount <stx>", "Amount of STX to deposit")
  .action(async (opts: { amount: string }) => {
    try {
      await assertDepositPhase();
      const account = await getAccount();
      const microStx = BigInt(Math.floor(parseFloat(opts.amount) * 1_000_000));

      const result = await callContract(account, {
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "deposit-stx",
        functionArgs: [uintCV(microStx)],
        postConditionMode: PostConditionMode.Deny,
        postConditions: [
          Pc.principal(account.address).willSendEq(microStx).ustx(),
        ],
      });

      printJson({
        success: true,
        txid: result.txid,
        action: "deposit-stx",
        amount: `${opts.amount} STX`,
        network: NETWORK,
        explorerUrl: getExplorerTxUrl(result.txid, NETWORK),
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("deposit-sbtc")
  .description("Deposit sBTC in satoshis into current auction cycle (deposit phase only)")
  .requiredOption("--amount <sats>", "Amount of sBTC in satoshis")
  .action(async (opts: { amount: string }) => {
    try {
      await assertDepositPhase();
      const account = await getAccount();
      const sats = BigInt(parseInt(opts.amount, 10));

      const result = await callContract(account, {
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "deposit-sbtc",
        functionArgs: [uintCV(sats)],
        postConditionMode: PostConditionMode.Deny,
        postConditions: [
          Pc.principal(account.address)
            .willSendEq(sats)
            .ft(SBTC_CONTRACT, "sbtc-token"),
        ],
      });

      printJson({
        success: true,
        txid: result.txid,
        action: "deposit-sbtc",
        amount: `${opts.amount} sats`,
        network: NETWORK,
        explorerUrl: getExplorerTxUrl(result.txid, NETWORK),
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("cancel-stx")
  .description("Cancel your STX deposit and get a refund (deposit phase only)")
  .action(async () => {
    try {
      await assertDepositPhase();
      const account = await getAccount();

      const result = await callContract(account, {
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "cancel-stx-deposit",
        functionArgs: [],
        postConditionMode: PostConditionMode.Allow,
        postConditions: [],
      });

      printJson({
        success: true,
        txid: result.txid,
        action: "cancel-stx-deposit",
        network: NETWORK,
        explorerUrl: getExplorerTxUrl(result.txid, NETWORK),
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("cancel-sbtc")
  .description("Cancel your sBTC deposit and get a refund (deposit phase only)")
  .action(async () => {
    try {
      await assertDepositPhase();
      const account = await getAccount();

      const result = await callContract(account, {
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "cancel-sbtc-deposit",
        functionArgs: [],
        postConditionMode: PostConditionMode.Allow,
        postConditions: [],
      });

      printJson({
        success: true,
        txid: result.txid,
        action: "cancel-sbtc-deposit",
        network: NETWORK,
        explorerUrl: getExplorerTxUrl(result.txid, NETWORK),
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// Write commands — settlement phase
// ---------------------------------------------------------------------------

program
  .command("close-deposits")
  .description("Close deposit phase (requires 150+ blocks elapsed, both sides above minimum)")
  .action(async () => {
    try {
      const data = await jingswapGet("/api/auction/cycle-state");
      if (data.phase !== 0) throw new Error("Not in deposit phase");
      const account = await getAccount();

      const result = await callContract(account, {
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "close-deposits",
        functionArgs: [],
        postConditionMode: PostConditionMode.Allow,
        postConditions: [],
      });

      printJson({
        success: true,
        txid: result.txid,
        action: "close-deposits",
        cycle: data.currentCycle,
        network: NETWORK,
        explorerUrl: getExplorerTxUrl(result.txid, NETWORK),
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("settle")
  .description("Settle with stored Pyth prices (free but usually stale — prefer settle-with-refresh)")
  .action(async () => {
    try {
      const data = await assertNotDepositPhase();
      const account = await getAccount();

      const result = await callContract(account, {
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "settle",
        functionArgs: [],
        postConditionMode: PostConditionMode.Allow,
        postConditions: [],
      });

      printJson({
        success: true,
        txid: result.txid,
        action: "settle",
        cycle: data.currentCycle,
        network: NETWORK,
        explorerUrl: getExplorerTxUrl(result.txid, NETWORK),
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("settle-with-refresh")
  .description("Settle with fresh Pyth VAAs (~2 uSTX) — recommended settlement method")
  .action(async () => {
    try {
      const data = await assertNotDepositPhase();
      const vaas = await jingswapGet("/api/auction/pyth-vaas");
      const account = await getAccount();

      const result = await callContract(account, {
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "settle-with-refresh",
        functionArgs: [
          bufferCV(Buffer.from(vaas.btcVaaHex, "hex")),
          bufferCV(Buffer.from(vaas.stxVaaHex, "hex")),
          contractPrincipalCV(PYTH_CONTRACTS.storage.address, PYTH_CONTRACTS.storage.name),
          contractPrincipalCV(PYTH_CONTRACTS.decoder.address, PYTH_CONTRACTS.decoder.name),
          contractPrincipalCV(PYTH_CONTRACTS.wormhole.address, PYTH_CONTRACTS.wormhole.name),
        ],
        postConditionMode: PostConditionMode.Allow,
        postConditions: [],
      });

      printJson({
        success: true,
        txid: result.txid,
        action: "settle-with-refresh",
        cycle: data.currentCycle,
        network: NETWORK,
        explorerUrl: getExplorerTxUrl(result.txid, NETWORK),
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("cancel-cycle")
  .description("Cancel cycle if settlement failed after 530 blocks (~17.5 min). Rolls deposits to next cycle.")
  .action(async () => {
    try {
      const data = await assertNotDepositPhase();
      const account = await getAccount();

      const result = await callContract(account, {
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "cancel-cycle",
        functionArgs: [],
        postConditionMode: PostConditionMode.Allow,
        postConditions: [],
      });

      printJson({
        success: true,
        txid: result.txid,
        action: "cancel-cycle",
        cycle: data.currentCycle,
        network: NETWORK,
        explorerUrl: getExplorerTxUrl(result.txid, NETWORK),
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse(process.argv);
