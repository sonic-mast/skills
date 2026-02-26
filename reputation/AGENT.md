---
name: reputation-agent
skill: reputation
description: ERC-8004 on-chain agent reputation management — submit and revoke feedback, append responses, approve clients, and query reputation summaries, feedback entries, and client lists.
---

# Reputation Agent

This agent manages ERC-8004 on-chain agent reputation using the reputation-registry contract. It handles submitting and revoking feedback, appending responses to feedback entries, approving clients, and all read-only queries for reputation data. Read operations work without a wallet. Write operations require an unlocked wallet.

## Capabilities

- Submit feedback for an agent with value, tags, and optional hash (give-feedback)
- Revoke previously submitted feedback as the original submitter (revoke-feedback)
- Append a response to an existing feedback entry (append-response)
- Approve a client to submit feedback up to an index limit (approve-client)
- Get aggregated reputation summary (count + WAD average) for an agent (get-summary)
- Read a specific feedback entry by agent ID, client, and index (read-feedback)
- Get a paginated list of all feedback entries with optional tag filtering (read-all-feedback)
- Get a paginated list of clients who gave feedback for an agent (get-clients)
- Get the total feedback count for an agent (get-feedback-count)
- Check the approved feedback index limit for a client on an agent (get-approved-limit)
- Get the last feedback index submitted by a client for an agent (get-last-index)

## When to Delegate Here

Delegate to this agent when the workflow needs to:
- Record on-chain feedback about an agent's performance or behavior
- Revoke inaccurate or outdated feedback previously submitted
- Allow an agent to respond to feedback on its own record
- Grant a client permission to submit feedback for an agent
- Retrieve an agent's current reputation score or feedback history
- Paginate through all feedback or clients for analytics or display
- Check whether a client is authorized to submit more feedback

## Key Constraints

- give-feedback, revoke-feedback, append-response, and approve-client all require an unlocked wallet
- revoke-feedback: tx-sender must be the original feedback submitter (the client address)
- approve-client: tx-sender must be the agent owner or an approved identity operator
- --feedback-hash and --response-hash must be exactly 32 bytes (64 hex characters); use SHA-256
- Feedback values are signed integers (negative values are allowed for negative feedback)
- Use --value-decimals to express fractional precision (e.g., value=5, value-decimals=1 means 0.5)
- Pagination is cursor-based; pass the cursor from one response into the next call to page through results
- Reputation is a Stacks L2 operation — check transaction status with `stx get-transaction-status` after write calls

## Example Invocations

```bash
# Submit positive feedback for agent 42
bun run reputation/reputation.ts give-feedback --agent-id 42 --value 5 --tag1 helpful

# Submit feedback with a hash of supporting evidence
bun run reputation/reputation.ts give-feedback --agent-id 42 --value 8 --value-decimals 1 --feedback-uri ipfs://evidence --feedback-hash a3f2b1...64hex

# Revoke feedback you previously submitted (index 0)
bun run reputation/reputation.ts revoke-feedback --agent-id 42 --index 0

# Append a response to a feedback entry
bun run reputation/reputation.ts append-response --agent-id 42 --client SP2... --index 0 --response-uri ipfs://myresponse --response-hash b4e9c2...64hex

# Approve a client to submit up to 5 feedback entries
bun run reputation/reputation.ts approve-client --agent-id 42 --client SP3... --index-limit 5

# Get reputation summary for agent 42
bun run reputation/reputation.ts get-summary --agent-id 42

# Read a specific feedback entry
bun run reputation/reputation.ts read-feedback --agent-id 42 --client SP2... --index 0

# List all feedback, filtering by tag
bun run reputation/reputation.ts read-all-feedback --agent-id 42 --tag1 helpful

# List feedback with pagination
bun run reputation/reputation.ts read-all-feedback --agent-id 42 --cursor 14

# List all clients who gave feedback
bun run reputation/reputation.ts get-clients --agent-id 42

# Get total feedback count
bun run reputation/reputation.ts get-feedback-count --agent-id 42

# Check if a client is approved to give feedback
bun run reputation/reputation.ts get-approved-limit --agent-id 42 --client SP3...

# Get the last feedback index a client submitted
bun run reputation/reputation.ts get-last-index --agent-id 42 --client SP3...
```
