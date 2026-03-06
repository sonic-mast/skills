#!/usr/bin/env bun
/**
 * nostr skill CLI
 * Publish Nostr notes and amplify aibtc.news signals to the Nostr network.
 * Uses secp256k1 Schnorr signatures via @noble/curves — no additional dependencies.
 *
 * Usage: bun run nostr/nostr.ts <subcommand> [options]
 */

import { Command } from "commander";
import * as secp from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { printJson, handleError } from "../src/lib/utils/cli.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOSTR_KEY_PATH = join(homedir(), ".aibtc", "nostr-key.json");

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NostrKeypair {
  privateKey: string; // hex
  publicKey: string;  // hex (x-only, 32 bytes)
}

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// ---------------------------------------------------------------------------
// Crypto helpers (pure Nostr/NIP-01)
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

function getNostrPublicKey(privKeyHex: string): string {
  return toHex(secp.schnorr.getPublicKey(privKeyHex));
}

async function hashEvent(event: Omit<NostrEvent, "id" | "sig">): Promise<Uint8Array> {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  const encoder = new TextEncoder();
  return sha256(encoder.encode(serialized));
}

async function signEvent(
  event: Omit<NostrEvent, "id" | "sig">,
  privKeyHex: string
): Promise<NostrEvent> {
  const hash = await hashEvent(event);
  const sig = await secp.schnorr.sign(hash, privKeyHex);
  return {
    ...event,
    id: toHex(hash),
    sig: toHex(sig),
  };
}

// ---------------------------------------------------------------------------
// Keypair management
// ---------------------------------------------------------------------------

function loadKeypair(): NostrKeypair {
  if (!existsSync(NOSTR_KEY_PATH)) {
    throw new Error(
      `No Nostr keypair found at ${NOSTR_KEY_PATH}. Run 'setup' first.`
    );
  }
  return JSON.parse(readFileSync(NOSTR_KEY_PATH, "utf8")) as NostrKeypair;
}

function saveKeypair(kp: NostrKeypair): void {
  const dir = join(homedir(), ".aibtc");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(NOSTR_KEY_PATH, JSON.stringify(kp, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Relay broadcast (NIP-01 via WebSocket)
// ---------------------------------------------------------------------------

async function publishToRelay(
  relayUrl: string,
  event: NostrEvent,
  timeoutMs = 8000
): Promise<{ relay: string; ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean, message?: string) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      resolve({ relay: relayUrl, ok, message });
    };

    const timer = setTimeout(() => settle(false, "timeout"), timeoutMs);

    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl);
    } catch (e) {
      clearTimeout(timer);
      return resolve({ relay: relayUrl, ok: false, message: String(e) });
    }

    ws.onopen = () => {
      ws.send(JSON.stringify(["EVENT", event]));
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string);
        if (Array.isArray(data) && data[0] === "OK" && data[1] === event.id) {
          clearTimeout(timer);
          settle(data[2] === true, data[3]);
        }
      } catch {}
    };

    ws.onerror = () => {
      clearTimeout(timer);
      settle(false, "connection error");
    };

    ws.onclose = () => {
      clearTimeout(timer);
      if (!settled) settle(false, "connection closed");
    };
  });
}

async function broadcastEvent(
  event: NostrEvent,
  relays: string[]
): Promise<{ event: NostrEvent; results: { relay: string; ok: boolean; message?: string }[] }> {
  const results = await Promise.all(relays.map((r) => publishToRelay(r, event)));
  return { event, results };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatSignalNote(signal: {
  beat?: string;
  content: string;
  signalId?: string;
  btcAddress?: string;
}): { content: string; tags: string[][] } {
  const parts: string[] = [];

  if (signal.beat) parts.push(`📡 aibtc.news — ${signal.beat}`);
  parts.push(signal.content);
  if (signal.signalId) parts.push(`\nSignal: ${signal.signalId}`);
  parts.push("\n#bitcoin #aibtcnews #nostr");

  const tags: string[][] = [
    ["t", "bitcoin"],
    ["t", "aibtcnews"],
    ["t", "nostr"],
  ];
  if (signal.signalId) tags.push(["r", `https://aibtc.news/signals/${signal.signalId}`]);

  return { content: parts.join("\n"), tags };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("nostr")
  .description("Publish Nostr notes and amplify aibtc.news signals")
  .version("1.0.0");

// setup
program
  .command("setup")
  .description("Generate a new Nostr keypair and save it locally")
  .option("--force", "Overwrite existing keypair")
  .action(async (opts) => {
    try {
      if (existsSync(NOSTR_KEY_PATH) && !opts.force) {
        throw new Error(
          `Keypair already exists at ${NOSTR_KEY_PATH}. Use --force to overwrite.`
        );
      }
      const privBytes = secp.utils.randomBytes(32);
      const privKeyHex = toHex(privBytes);
      const publicKey = getNostrPublicKey(privKeyHex);
      const kp: NostrKeypair = { privateKey: privKeyHex, publicKey };
      saveKeypair(kp);
      printJson({
        success: true,
        publicKey,
        keyPath: NOSTR_KEY_PATH,
        note: "Keep your private key safe — it is stored at the path above.",
      });
    } catch (e) {
      handleError(e);
    }
  });

// get-pubkey
program
  .command("get-pubkey")
  .description("Display the agent's Nostr public key (npub)")
  .action(async () => {
    try {
      const kp = loadKeypair();
      // Convert to npub (bech32) — simple hex display for now
      printJson({
        success: true,
        publicKey: kp.publicKey,
        publicKeyHex: kp.publicKey,
        note: "Use a Nostr client to import this pubkey as hex or convert to npub.",
      });
    } catch (e) {
      handleError(e);
    }
  });

// publish
program
  .command("publish")
  .description("Publish a plain-text note (kind:1) to Nostr relays")
  .requiredOption("--content <text>", "Note content")
  .option("--relays <urls>", "Comma-separated relay URLs", DEFAULT_RELAYS.join(","))
  .option("--tags <json>", "Extra tags as JSON array of arrays, e.g. '[[\\'t\\',\\'bitcoin\\']]'")
  .action(async (opts) => {
    try {
      const kp = loadKeypair();
      const relays = (opts.relays as string).split(",").map((r) => r.trim());
      const extraTags: string[][] = opts.tags ? JSON.parse(opts.tags) : [];

      const unsigned: Omit<NostrEvent, "id" | "sig"> = {
        pubkey: kp.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [...extraTags],
        content: opts.content,
      };

      const event = await signEvent(unsigned, kp.privateKey);
      const result = await broadcastEvent(event, relays);
      printJson({ success: true, ...result });
    } catch (e) {
      handleError(e);
    }
  });

// amplify-signal
program
  .command("amplify-signal")
  .description("Fetch an aibtc.news signal and broadcast it as a Nostr note")
  .requiredOption("--signal-id <id>", "Signal ID from aibtc.news")
  .option("--beat <name>", "Beat name for context (e.g. 'BTC Macro')")
  .option("--relays <urls>", "Comma-separated relay URLs", DEFAULT_RELAYS.join(","))
  .action(async (opts) => {
    try {
      const kp = loadKeypair();
      const relays = (opts.relays as string).split(",").map((r) => r.trim());

      // Fetch signal from aibtc.news API
      const res = await fetch(`https://1btc-news-api.p-d07.workers.dev/takes/${opts.signalId}`);
      if (!res.ok) throw new Error(`Failed to fetch signal: ${res.status}`);
      const signal = (await res.json()) as { thesis?: string; target_claim?: string; beat_topic?: string };

      const content = signal.thesis || signal.target_claim || "";
      if (!content) throw new Error("Signal has no content to amplify");

      const { content: noteContent, tags } = formatSignalNote({
        beat: opts.beat || signal.beat_topic || "aibtc.news",
        content,
        signalId: opts.signalId,
      });

      const unsigned: Omit<NostrEvent, "id" | "sig"> = {
        pubkey: kp.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags,
        content: noteContent,
      };

      const event = await signEvent(unsigned, kp.privateKey);
      const result = await broadcastEvent(event, relays);
      printJson({ success: true, signalId: opts.signalId, ...result });
    } catch (e) {
      handleError(e);
    }
  });

// amplify-text
program
  .command("amplify-text")
  .description("Publish formatted aibtc.news signal content directly (no API fetch needed)")
  .requiredOption("--content <text>", "Signal content/thesis")
  .option("--beat <name>", "Beat name", "BTC Macro")
  .option("--signal-id <id>", "Signal ID for reference link")
  .option("--relays <urls>", "Comma-separated relay URLs", DEFAULT_RELAYS.join(","))
  .action(async (opts) => {
    try {
      const kp = loadKeypair();
      const relays = (opts.relays as string).split(",").map((r) => r.trim());

      const { content: noteContent, tags } = formatSignalNote({
        beat: opts.beat,
        content: opts.content,
        signalId: opts.signalId,
      });

      const unsigned: Omit<NostrEvent, "id" | "sig"> = {
        pubkey: kp.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags,
        content: noteContent,
      };

      const event = await signEvent(unsigned, kp.privateKey);
      const result = await broadcastEvent(event, relays);
      printJson({ success: true, ...result });
    } catch (e) {
      handleError(e);
    }
  });

program.parse();
