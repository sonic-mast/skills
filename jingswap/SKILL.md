---
name: jingswap
description: "Jingswap blind batch auction for STX/sBTC — query cycle state, prices, depositors, settlements, history, user activity. Deposit/cancel STX and sBTC, close deposits, settle with fresh Pyth oracles, cancel failed cycles."
metadata:
  author: "Rapha-btc"
  author-agent: "Claude Code"
  user-invocable: "false"
  arguments: "cycle-state | depositors | user-deposit | settlement | cycles-history | user-activity | prices | deposit-stx | deposit-sbtc | cancel-stx | cancel-sbtc | close-deposits | settle | settle-with-refresh | cancel-cycle"
  entry: "jingswap/jingswap.ts"
  mcp-tools: "jingswap_get_cycle_state, jingswap_get_depositors, jingswap_get_user_deposit, jingswap_get_settlement, jingswap_get_cycles_history, jingswap_get_user_activity, jingswap_get_prices, jingswap_deposit_stx, jingswap_deposit_sbtc, jingswap_cancel_stx, jingswap_cancel_sbtc, jingswap_close_deposits, jingswap_settle, jingswap_settle_with_refresh, jingswap_cancel_cycle"
  requires: "wallet"
  tags: "l2, write, requires-funds, defi"
---

# Jingswap Skill

Blind batch auction for swapping STX and sBTC on Stacks. Each auction cycle has three phases: deposit, buffer, settle. Anyone can participate by depositing on either side, and anyone can trigger close/settle/cancel transitions.

Contract: `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.sbtc-stx-jingswap`

## Usage

```
bun run jingswap/jingswap.ts <subcommand> [options]
```

## Subcommands

### cycle-state

Get current auction cycle state (phase, blocks elapsed, totals, minimums).

```
bun run jingswap/jingswap.ts cycle-state
```

### depositors

Get STX and sBTC depositors for a cycle.

```
bun run jingswap/jingswap.ts depositors --cycle <number>
```

### user-deposit

Get a user's deposit amounts for a cycle.

```
bun run jingswap/jingswap.ts user-deposit --cycle <number> --address <stx_address>
```

### settlement

Get settlement details for a completed cycle.

```
bun run jingswap/jingswap.ts settlement --cycle <number>
```

### cycles-history

Get full history of all auction cycles.

```
bun run jingswap/jingswap.ts cycles-history
```

### user-activity

Get a user's auction activity (deposits, cancellations, fills, rollovers).

```
bun run jingswap/jingswap.ts user-activity --address <stx_address>
```

### prices

Get oracle and DEX prices (Pyth, XYK pool, DLMM).

```
bun run jingswap/jingswap.ts prices
```

### deposit-stx

Deposit STX into the current auction cycle. Deposit phase only.

```
bun run jingswap/jingswap.ts deposit-stx --amount <stx_amount>
```

### deposit-sbtc

Deposit sBTC (in satoshis) into the current auction cycle. Deposit phase only.

```
bun run jingswap/jingswap.ts deposit-sbtc --amount <sats>
```

### cancel-stx

Cancel your STX deposit and get a refund. Deposit phase only.

```
bun run jingswap/jingswap.ts cancel-stx
```

### cancel-sbtc

Cancel your sBTC deposit and get a refund. Deposit phase only.

```
bun run jingswap/jingswap.ts cancel-sbtc
```

### close-deposits

Close the deposit phase (requires min 150 blocks elapsed, min 1 STX and 1,000 sats deposited).

```
bun run jingswap/jingswap.ts close-deposits
```

### settle

Settle using stored Pyth prices (free). Usually fails due to stale prices — prefer settle-with-refresh.

```
bun run jingswap/jingswap.ts settle
```

### settle-with-refresh

Settle with fresh Pyth VAAs (~2 uSTX). Recommended settlement method.

```
bun run jingswap/jingswap.ts settle-with-refresh
```

### cancel-cycle

Cancel cycle if settlement failed after 530 blocks (~17.5 min). Rolls deposits to next cycle.

```
bun run jingswap/jingswap.ts cancel-cycle
```

## Notes

- Stacks blocks average ~2 seconds (Nakamoto)
- Deposit phase: min 150 blocks (~5 min) before close
- Buffer phase: 30 blocks (~1 min) after close
- Cancel threshold: 530 blocks (~17.5 min) from close
- `distribute` events show swap proceeds + unswapped remainder (rolled to next cycle, not refunded)
- Post conditions: deposits use Deny mode; cancel/settle/cancel-cycle use Allow mode (nothing leaves caller's wallet)
