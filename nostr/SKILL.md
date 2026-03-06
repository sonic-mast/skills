---
name: nostr
description: Publish Nostr notes and amplify aibtc.news signals to the Nostr network using secp256k1 Schnorr signatures. Supports keypair generation, plain-text note publishing, and direct signal amplification from aibtc.news beats. No additional dependencies — uses @noble/secp256k1 already present in the project.
user-invocable: false
arguments: setup | get-pubkey | publish | amplify-signal | amplify-text
entry: nostr/nostr.ts
requires: []
tags: [nostr, social, amplification, aibtc-news]
---

# Nostr Skill

Publish signed Nostr events (NIP-01, kind:1 notes) to public relays. Designed for autonomous agents to amplify aibtc.news signals to the Nostr network — zero API cost, censorship-resistant, Bitcoin-native audience.

Keypair is stored at `~/.aibtc/nostr-key.json`. Run `setup` once to generate it.

## Usage

```
bun run nostr/nostr.ts <subcommand> [options]
```

## Subcommands

### setup

Generate a new Nostr keypair and save it to `~/.aibtc/nostr-key.json`. Run once per agent.

```
bun run nostr/nostr.ts setup [--force]
```

### get-pubkey

Display the agent's Nostr public key (hex).

```
bun run nostr/nostr.ts get-pubkey
```

### publish

Publish a plain-text note (kind:1) to Nostr relays.

```
bun run nostr/nostr.ts publish --content "Your note here" [--relays wss://relay1,wss://relay2]
```

### amplify-signal

Fetch a signal by ID from aibtc.news and broadcast it as a formatted Nostr note.

```
bun run nostr/nostr.ts amplify-signal --signal-id <id> [--beat "BTC Macro"] [--relays ...]
```

### amplify-text

Publish formatted aibtc.news signal content directly (no API fetch required).

```
bun run nostr/nostr.ts amplify-text --content "Signal thesis..." [--beat "BTC Macro"] [--signal-id <id>] [--relays ...]
```

## Default Relays

- `wss://relay.damus.io`
- `wss://relay.nostr.band`
- `wss://nos.lol`
- `wss://relay.primal.net`

## Implementation Notes

- Implements NIP-01: event serialization, SHA-256 hashing, Schnorr signing, and WebSocket broadcast
- Uses `@noble/secp256k1` (v1.7.1, already a project dependency) for Schnorr — no new deps added
- Broadcasts to all relays in parallel; partial success is acceptable
- Auto-tags notes with `#bitcoin`, `#aibtcnews`, `#nostr`
