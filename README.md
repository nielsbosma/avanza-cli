# avanza-cli

An agent-first CLI for [Avanza](https://www.avanza.se). AI agents (Claude Code, Codex, …) can read every holding in
your Avanza accounts and place limit orders, **within limits you set**.

- **Read:** accounts and holdings with full statistics: position, P/L, today's change, returns, dividends, valuation, fund fees.
- **Trade:** limit orders to buy and sell, in accounts you authorise, with per-order and per-day limits.
- **Agent-native:** YAML output (`--json` for JSON), a built-in `avanza agent readme`, and `avanza agent install`
  that wires the CLI into local agents.
- **Human-controlled:** only you can log in, install the agent skills and grant permissions. Those commands refuse
  to run without a terminal, so an agent cannot grant itself rights.

> ⚠️ **Unofficial.** Avanza has no public API. This tool calls the same private web endpoints avanza.se uses in the
> browser. Avanza's terms may not allow automated access, endpoints can change without notice, and orders placed
> through this tool are real. You accept this when you run `avanza auth login`. Use a small, dedicated account for
> agent trading.

## Install

Requires Node.js 20+.

```bash
npm install -g avanza-cli
```

(Or from source: `npm install && npm run build && npm link`.)

## Setup (human)

```bash
avanza auth login          # username, password, TOTP secret → OS keychain, verified against Avanza
avanza agent permissions   # per account: read / trade, and trading limits
avanza agent install       # install the pointer skill for Claude Code / Codex
```

**TOTP secret:** Avanza only supports logins with an authenticator app here (not BankID). In Avanza's login
settings, enable an authenticator app and choose to see the code as text instead of scanning the QR code; that
base32 string is the secret. Add the same secret to your phone's authenticator too, so you keep access.

**Headless:** `AVANZA_USERNAME`, `AVANZA_PASSWORD` and `AVANZA_TOTP_SECRET` override the keychain.

## Agent commands

Agents should start with `avanza agent readme`: the full, versioned usage guide, generated from the command
definitions.

| Command | Returns |
|---|---|
| `avanza agent readme` | The usage guide for agents (Markdown) |
| `avanza accounts list` | Readable accounts: id, name, type, total value, buying power, cash |
| `avanza accounts show <accountId>` | One account with totals, performance and allocation |
| `avanza holdings list [--account <id>] [--no-details]` | Every holding with full statistics |
| `avanza holdings show <orderbookId> [--account <id>]` | One holding in depth plus instrument key ratios |
| `avanza instruments search <query> [--type stock\|fund\|etf\|certificate\|warrant]` | Orderbook id, name, ticker, currency, market |
| `avanza instruments show <orderbookId>` | Quote, bid/ask, day change, returns, key ratios |
| `avanza transactions list [--account <id>] [--from] [--to] [--type]` | Buys, sells, dividends, deposits, fees |
| `avanza orders list [--account <id>]` | Open orders and today's deals |
| `avanza orders buy --account <id> --orderbook <id> --volume <n> --price <p> [--valid-until <date>] [--dry-run]` | Order preview or placed order |
| `avanza orders sell …` | Same flags as buy |
| `avanza orders cancel --account <id> --order <id>` | Cancellation result |

Output is YAML with a top-level `kind` and `schema_version`; money is `{ amount, currency }`, percentages are plain
numbers, dates ISO 8601. Errors are structured too, with exit codes `0` ok, `1` usage, `2` auth, `3` permission
denied, `4` Avanza API error, `5` order rejected.

```yaml
kind: error
schema_version: 1
error:
  code: permission_denied
  message: Account 1234567 is not enabled for trading.
  hint: A human can grant it with `avanza agent permissions`.
```

## Permissions and trading safety

Default is **deny**: until you run `avanza agent permissions`, agents can read and trade nothing. Accounts without
read permission are invisible to agents. New accounts at Avanza default to no access.

`~/.config/avanza-cli/permissions.yaml`:

```yaml
schema_version: 1
accounts:
  "7654321":
    name: ISK Agent sandbox
    read: true
    trade: true
    limits:
      max_order_value: { amount: 10000, currency: SEK }
      max_daily_value: { amount: 25000, currency: SEK }
      allowed_sides: [buy, sell]
```

Every order passes these checks, in order, before Avanza is called:

1. Global kill switch (`trading_enabled` in `config.yaml`).
2. Trade permission on the account, side in `allowed_sides`.
3. Instrument is tradable now (funds are not supported).
4. Order value within `max_order_value`; today's placed orders plus this one within `max_daily_value` (SEK; foreign
   currency is converted with the rate implied by a position in that currency, and refused if there is none).
5. Buy: within buying power. Sell: no more than the holding.
6. Price within ±`price_band_percent` (default 10) of the last price — catches 2710 for 271.0.
7. No identical order in the last `duplicate_window_seconds` (default 60) unless `--allow-duplicate`.

`--dry-run` stops after the checks and returns the preview. Only limit orders are supported. Every placed,
rejected, refused and cancelled order is appended to `~/.config/avanza-cli/audit.log` (JSON lines, with the calling
agent when it can be detected).

`~/.config/avanza-cli/config.yaml`:

```yaml
trading_enabled: true
price_band_percent: 10
duplicate_window_seconds: 60
audit_reads: false
```

Permissions are a guardrail against agent mistakes, not a security boundary against a malicious local process:
anything running as your user can read the keychain. The CLI warns when `permissions.yaml` was edited outside
`agent permissions` (its checksum is kept in the keychain).

## Files

| What | Where |
|---|---|
| Username, password, TOTP secret | OS keychain (service `avanza-cli`); fallback: AES-256-GCM `credentials.enc`, key from `AVANZA_CLI_PASSPHRASE` |
| Session cookies + token | `~/.config/avanza-cli/session.json` (0600; safe to delete) |
| Permissions, config, audit log | `~/.config/avanza-cli/` |

`AVANZA_CLI_HOME` moves the whole directory.

## As a library

```ts
import { createClient } from "avanza-cli";

const avanza = createClient();
const { accounts } = await avanza.overview();
const positions = await avanza.positions();
```

The library is the typed client only: no permission checks.

## Development

```bash
npm install
npm run typecheck
npm test                 # unit tests with recorded-shape fixtures
npm run build
```

Contract tests are opt-in and run against a real account. They call every read endpoint and validate the response
against its zod schema; no test places an order.

```bash
AVANZA_USERNAME=… AVANZA_PASSWORD=… AVANZA_TOTP_SECRET=… npm run test:contract
```

## Credits

The knowledge of Avanza's private endpoints comes from [Qluxzz/avanza](https://github.com/Qluxzz/avanza) and its
upstream [fhqvst/avanza](https://github.com/fhqvst/avanza) (both MIT). This is an independent TypeScript
implementation; no code from them runs here. See [NOTICE](NOTICE).

## Licence

MIT. See [LICENSE](LICENSE).
