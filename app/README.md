# Issuer console (`@ika-rwa/app`)

Next.js 16 app with two parts:

| route | what |
|---|---|
| `/` | Landing page. Editorial layout, an engraved line field drawn on canvas, and a policy simulator that runs the real `evaluate()` in the browser. |
| `/console` | The issuer console: ledger overview, `/console/intents`, `/console/setup`. |
| `/api/**` | Server routes used by the console in devnet mode. |

## Run

```bash
pnpm --filter @ika-rwa/app dev                                                       # mock mode, http://localhost:3000
NEXT_PUBLIC_LEDGER_MODE=devnet LEDGER_DELIVER=live pnpm --filter @ika-rwa/app dev    # live on devnet and the testnets
```

Devnet mode needs `pnpm setup:devnet` first and the sdk and executor packages built (`pnpm -r build`). Mock mode simulates chain state from `src/seed.ts` and needs neither.

## Console keys

| key | action |
|---|---|
| `C` | New intent |
| `⌘ ↵` | Create the intent |
| `Esc` | Close the modal or the intent panel |

Switch the acting approver in the sidebar. Approver keys stay on the server; the switch picks which one signs.

## Demo flow

1. Press `C`, keep Mint · Base · 2,500,000, press `⌘ ↵`.
2. In the sidebar pick Bob, approve. Pick Carol, approve.
3. Wait for the 5 second timelock, press Execute. Base goes to 10M.
4. Press `C` again, set Ethereum and 40,000,000. The global cap and the Ethereum cap both fail.
5. Try a Move from Ethereum to Sui. The burn leg confirms before the mint leg starts.

## Server routes (devnet mode)

| route | does |
|---|---|
| `GET /api/ledger` | reads the Asset, ChainDeployment and Intent accounts |
| `POST /api/intents` | `create_intent`, signed by the selected approver |
| `POST /api/intents/[id]/approve` | `approve_intent` |
| `POST /api/intents/[id]/execute` | NDJSON stream of step events from `@ika-rwa/executor` |

Env: `LEDGER_DEPLOYMENT_FILE` (default `../deployments/devnet.json`), `LEDGER_KEYS_DIR` (default `../keys`), `LEDGER_DELIVER=mock|live`.

## Layout

```
src/app/page.tsx           landing page
src/landing/               Hero, LineField (canvas), Simulator, DarkBand, Reveal
src/app/console/           ledger, intents, setup pages (layout wraps them in AppShell)
src/components/            AppShell, IntentList, IntentDrawer, NewIntentModal, ExecutionStepper,
                           PolicyCheckPanel, SupplyBar, ChainLogo, ui (StatusIcon, Hash, Avatar, Property)
src/policy/policy.ts       evaluate(), evaluateExecution(), program error text
src/executor/              Executor interface, MockExecutor, DevnetExecutor
src/store/                 Zustand store
src/server/devnet.ts       server bridge to @ika-rwa/ledger-sdk and @ika-rwa/executor
```

## Checks

```bash
pnpm --filter @ika-rwa/app test
pnpm --filter @ika-rwa/app lint
pnpm --filter @ika-rwa/app typecheck
pnpm --filter @ika-rwa/app build
```
