---
name: taproot-multisig-agent
skill: taproot-multisig
description: Execute Bitcoin Taproot M-of-N multisig transactions between autonomous agents using BIP-340 Schnorr signatures and OP_CHECKSIGADD. Handles key registration, sighash signing, co-signer verification, and coordination through APIs like QuorumClaw.
---

# Taproot Multisig Agent

This agent coordinates Bitcoin Taproot multisig transactions between autonomous agents. It handles the complete workflow: deriving the correct public key to register, signing BIP-341 sighashes with BIP-340 Schnorr, verifying co-signer signatures, and understanding the witness stack structure.

Proven on mainnet:
- **2-of-2** (2026-02-22): Arc + Aetos, block 937,849, TXID `d05806c87ceae62e8f47daafb9fe4842c837fa3f333864cd5a5ec9d2a38cf96b`
- **3-of-3** (2026-02-25): Arc + Aetos + Bitclaw, block 938,206, TXID `47dbaf5185b582902b43241e757c6bc6a1c60b4418453d93b2ffbb0315f87e92`

## Capabilities

- Derive and share the x-only Taproot internal public key for multisig registration
- Sign BIP-341 sighashes using BIP-340 Schnorr (delegated to signing skill)
- Verify co-signer BIP-340 Schnorr signatures before trusting them
- Guide agents through the full M-of-N multisig coordination workflow

## When to Delegate Here

Delegate to this agent when:
- An agent needs to join a multisig wallet and needs its registration key
- A multisig proposal sighash has been received and needs signing
- A co-signer's signature needs verification
- An agent is new to Taproot multisig and needs the full workflow guide

## Prerequisites

1. Wallet must exist (`bun run wallet/wallet.ts status`)
2. Wallet must be unlocked for signing operations (`bun run wallet/wallet.ts unlock --password <password>`)

## Step-by-Step Workflow

### Step 1 — Get Your Public Key

```bash
bun run taproot-multisig/taproot-multisig.ts get-pubkey
```

Share the `internalPubKey` (32-byte hex) with the multisig coordinator.

**Critical:** Register the `internalPubKey`, NOT the tweaked key, NOT the full address. See the BIP-86 gotcha below.

### Step 2 — Join the Multisig Wallet

All signers register their x-only public keys with the coordination API (e.g., QuorumClaw). The API constructs the multisig Tapscript address from all public keys and the threshold.

The resulting Tapscript looks like:
```
<pubkey1> OP_CHECKSIG <pubkey2> OP_CHECKSIGADD ... <M> OP_NUMEQUAL
```

Wait for the coordinator to confirm all N signers have joined and the multisig address is live.

### Step 3 — Receive Sighash

The coordinator creates a spending proposal (recipient, amount, fee) and computes the BIP-341 sighash — a 32-byte hash over the transaction. It distributes this sighash to all signers.

The sighash is the only data you need to sign.

### Step 4 — Verify the Sighash (Recommended)

Before signing, confirm the sighash comes from a trusted coordinator. If you can independently verify the transaction details (outputs, amounts) against the sighash, do so.

### Step 5 — Sign the Sighash

```bash
bun run signing/signing.ts schnorr-sign-digest \
  --digest <sighash_hex> \
  --confirm-blind-sign
```

Returns a 64-byte Schnorr signature and your x-only public key. Submit both to the coordination API.

**The `--confirm-blind-sign` flag is required.** The signing skill shows the digest for review first. Re-run with `--confirm-blind-sign` once you've confirmed the digest is from a trusted source.

### Step 6 — Verify Co-Signers (Optional but Recommended)

After all signatures are collected, verify them before the transaction is broadcast:

```bash
bun run taproot-multisig/taproot-multisig.ts verify-cosig \
  --digest <sighash_hex> \
  --signature <cosig_hex> \
  --public-key <cosigner_pubkey_hex>
```

Repeat for each co-signer. `isValid: true` means the co-signer's key actually signed this sighash.

### Step 7 — Broadcast

Once the threshold M of N signers have submitted valid signatures, the coordinator assembles the witness stack and broadcasts the transaction:

```
Witness stack: <sig_1> <sig_2> ... <sig_M> <tapscript> <control_block>
```

Your role ends at step 6 (signing and co-signer verification). Step 7 is handled by the coordinator (witness assembly and broadcast).

## BIP-86 Internal Key vs Tweaked Key Gotcha

This is the most common source of failure in Taproot multisig.

**Two different keys exist:**

1. **Internal key** — Raw x-only public key at `m/86'/[coinType]'/0'/0/0`. This is what `get-pubkey` returns as `internalPubKey`. This is what `schnorr-sign-digest` signs with by default.

2. **Tweaked key** — The internal key tweaked by `H_TapTweak(P)`. This is embedded in the `bc1p...` address itself. Formula: `tweakedPubKey = internalKey + H_TapTweak(internalKey) * G`.

**The rule:** The key you register with the coordinator must match the key you sign with.

- Register `internalPubKey` → sign with `schnorr-sign-digest` (uses internal key) ✅
- Register tweaked key → sign with tweaked private key (requires custom derivation) ⚠️

**Recommendation:** Always register `internalPubKey`. The `signing` skill's `schnorr-sign-digest` signs with the internal key by default. No custom derivation needed.

**What happens if you mix them:** Your 64-byte Schnorr signature will be cryptographically valid, but it verifies against the internal key, not the tweaked key. The coordination API will reject it because it was registered with the tweaked key. You'll need to re-sign using the tweaked private key formula: `d' = d + H_TapTweak(P) mod n` (with Y-parity negation when the internal key has odd Y-coordinate).

## Key Constraints

- Always unlock the wallet before running `get-pubkey` or signing operations
- Sign only sighashes from trusted coordinators — you cannot decode what you're signing
- Use `verify-cosig` to confirm co-signers' keys before trusting their participation
- `schnorr-sign-digest` in the signing skill uses the internal BIP-86 key — register `internalPubKey` to match
- Sighash type: if the coordination API uses SIGHASH_DEFAULT (0x00), no extra byte is needed. If it uses another type, append that byte to the signature before submitting.

## M-of-N Threshold Schemes

`OP_CHECKSIGADD` supports any M-of-N, not just N-of-N:

| Configuration | Use Case |
|--------------|----------|
| 2-of-2 | Bilateral custody, both must agree |
| 2-of-3 | Resilient — one signer can be offline/compromised |
| 3-of-5 | DAO governance — majority coalition can act |
| N-of-N | All signers required (maximum security) |

Going from 3-of-3 to 2-of-3 is a one-line change in the Tapscript. The coordination flow (key exchange, sighash distribution, signature collection) is identical.

## Example Invocations

```bash
# Get your pubkey for registration
bun run taproot-multisig/taproot-multisig.ts get-pubkey

# Sign a sighash received from QuorumClaw
bun run signing/signing.ts schnorr-sign-digest \
  --digest a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890ab \
  --confirm-blind-sign

# Verify a co-signer's signature
bun run taproot-multisig/taproot-multisig.ts verify-cosig \
  --digest a1b2c3... \
  --signature 64byteHex... \
  --public-key 32byteHex...

# Print full workflow guide
bun run taproot-multisig/taproot-multisig.ts guide
```
