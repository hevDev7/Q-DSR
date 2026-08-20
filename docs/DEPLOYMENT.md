# Deployment runbook

Testnet first, always. The mainnet deployment is the Wave 3 submission artifact
and the registry is append-only — a mistake there is permanent.

Each stage below has to pass before the next one starts.

---

## Stage 0 — local node

Proves the deploy script, the contract gate and the API anchoring path without
spending anything. Nothing here needs credentials or funds.

```bash
# terminal 1
pnpm --filter @workspace/contracts run node

# terminal 2 — the first hardhat account, publicly known and worthless
export DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

pnpm --filter @workspace/contracts run deploy:local
pnpm --filter @workspace/contracts run validate:local
```

`validate:local` runs 15 checks, including the two that matter most: a mint
reverting for an uncertified agent, and the same mint succeeding after a passing
verdict is recorded.

### Verified end to end on 2026-08-20

| Check | Result |
|---|---|
| Deploy script writes both contracts and a deployments record | ✅ |
| 15/15 deployment validation checks | ✅ |
| API server anchors a **certified** verdict on chain | ✅ block 8 |
| API server anchors an **insignificant** verdict on chain | ✅ block 9 |
| On-chain `isCertified` matches the engine verdict | ✅ true / false |
| Mint gate | ✅ ALLOWED / `AgentNotCertified` |

The API sent measurements only — `dsrBps 9982, pboBps 4` and `dsrBps 4889,
pboBps 5041`. The contract derived both verdicts itself.

To repeat the API half:

```bash
REG=$(node -p "require('./contracts/deployments/localhost.json').contracts.QDSRRegistry")
AID=$(node -p "require('./contracts/deployments/localhost.json').contracts.AgenticID")

QDSR_DATA_DIR=.data-chain PORT=8081 \
  OG_RPC_URL=http://127.0.0.1:8545 \
  OG_CHAIN_ID=31337 \
  OG_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  QDSR_REGISTRY_ADDRESS=$REG AGENTIC_ID_ADDRESS=$AID \
  pnpm --filter @workspace/api-server run start
```

`GET /api/chain/config` should report `configured: true`. Anchor a run and the
response carries a real `chainTxHash` and `blockNumber`.

---

## Stage 1 — 0G Galileo testnet

**Chain 16602 · `https://evmrpc-testnet.0g.ai` · `https://chainscan-galileo.0g.ai`**

### 1. Fund a deployer

Use a key that has never touched mainnet and holds nothing of value. To generate
one and write it straight into the gitignored env file:

```bash
node -e "
const {Wallet}=require('./contracts/node_modules/ethers'), fs=require('fs');
const w=Wallet.createRandom();
fs.writeFileSync('contracts/.env',
  'DEPLOYER_PRIVATE_KEY='+w.privateKey+'\nATTESTOR_ADDRESS='+w.address+'\n',{mode:0o600});
console.log(w.address);"
```

`contracts/.env` is gitignored and is loaded automatically by hardhat.config.ts,
so the key never needs to be exported into your shell — and never reaches your
shell history.

Request tokens for that address at **https://faucet.0g.ai/**. If the faucet is
rate-limited, ask in the 0G Buildathon Telegram support channel.

### 2. Preflight

```bash
pnpm --filter @workspace/contracts run preflight:testnet
```

Checks the key is set, the RPC is reachable, the chain id is really 16602, the
deployer is funded, and the contracts are compiled. It exits non-zero rather
than letting a deployment fail halfway.

### 3. Deploy

```bash
pnpm --filter @workspace/contracts run deploy:testnet
```

Addresses and explorer links land in `contracts/deployments/ogTestnet.json`.

### 4. Validate

```bash
pnpm --filter @workspace/contracts run validate:testnet
```

Same 15 checks, now against a public chain. It prints explorer links for every
transaction it sent — those are worth keeping for the submission.

### 5. Verify the source on the explorer

```bash
pnpm --filter @workspace/contracts run verify:testnet -- <REGISTRY_ADDRESS> <ATTESTOR_ADDRESS>
pnpm --filter @workspace/contracts run verify:testnet -- <AGENTIC_ID_ADDRESS> <REGISTRY_ADDRESS>
```

Judges read contracts. Verified source on Chainscan is worth more than a
paragraph claiming what the contract does.

### 6. Point the API at it and run the real workflow

```bash
export OG_RPC_URL=https://evmrpc-testnet.0g.ai
export OG_CHAIN_ID=16602
export OG_PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY
export QDSR_REGISTRY_ADDRESS=$(node -p "require('./contracts/deployments/ogTestnet.json').contracts.QDSRRegistry")
export AGENTIC_ID_ADDRESS=$(node -p "require('./contracts/deployments/ogTestnet.json').contracts.AgenticID")

pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/scripts run seed-demo
```

The dashboard header should read **0G Galileo testnet connected**, and each
anchored agent should carry a working Chainscan link.

### Testnet exit criteria

- [ ] 15/15 validation checks pass on 16602
- [ ] Both contracts verified on Chainscan
- [ ] A certified agent anchored, with an explorer link
- [ ] An insignificant agent anchored, with an explorer link
- [ ] A mint blocked on chain for the insignificant agent
- [ ] Gas cost per verdict recorded, so the mainnet budget is known

---

## Stage 2 — 0G mainnet

**Chain 16661 · `https://evmrpc.0g.ai` · `https://chainscan.0g.ai`**

Only after every testnet box is ticked.

### Decide the attestor deliberately

On testnet the deployer doubles as the attestor. On mainnet, decide whether that
is what you want — the attestor is the account allowed to write verdicts, and
`ATTESTOR_ADDRESS` sets it at construction. The deployer keeps ownership and can
add or remove attestors later.

Put the mainnet key and attestor in `contracts/.env`, then:

```bash
pnpm --filter @workspace/contracts run preflight:mainnet
pnpm --filter @workspace/contracts run deploy:mainnet
pnpm --filter @workspace/contracts run verify:mainnet -- <REGISTRY> <ATTESTOR>
pnpm --filter @workspace/contracts run verify:mainnet -- <AGENTIC_ID> <REGISTRY>
```

### Validating mainnet

`validate:mainnet` runs the read-only checks by default and **skips the write
checks**, because they would put scratch agents into the permanent registry.
Opt in only if that is what you intend:

```bash
VALIDATE_ALLOW_WRITES=1 pnpm --filter @workspace/contracts run validate:mainnet
```

The read-only pass still confirms bytecode, all four thresholds, the AgenticID
wiring and attestor authorisation — enough to know the deployment is sound.

### For the submission

Wave 3 asks for a mainnet contract address, an explorer link showing on-chain
activity, and proof of at least one 0G component. After a real verdict is
anchored you have all three:

- `https://chainscan.0g.ai/address/<QDSRRegistry>`
- `https://chainscan.0g.ai/address/<AgenticID>`
- `https://chainscan.0g.ai/tx/<verdict transaction>`

---

## Keys

`DEPLOYER_PRIVATE_KEY` lives in `contracts/.env`, which is gitignored, as is
every `.env*` at the repository root except `.env.example`. `contracts/deployments/`
is gitignored too — it holds deploy output, not source.

Use a key funded for this purpose alone. The testnet deployer should be a
throwaway; for mainnet, decide the attestor deliberately, because that account is
the one permitted to write verdicts.
