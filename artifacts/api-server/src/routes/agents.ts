import { Router, type IRouter } from 'express';

import type { AppContext } from '../context.js';
import { accentFor, newId } from '../lib/ids.js';
import {
  PublishedEvidenceError,
  fetchPublishedEvidence,
} from '../services/published-evidence.js';
import { toAgentDto, toRunDto } from '../services/mapper.js';
import { buildMintIntent } from '../services/mint.js';
import { EvidenceRequestError } from '../services/verification.js';

export function agentsRouter(ctx: AppContext): IRouter {
  const router: IRouter = Router();

  router.get('/agents', async (req, res) => {
    const agents = await ctx.store.listAgents();
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;

    const visible = agents
      .filter((agent) => (status ? agent.status === status : true))
      .filter((agent) =>
        search
          ? `${agent.name} ${agent.family} ${agent.owner}`.toLowerCase().includes(search)
          : true,
      );

    // One concurrent pass over the chain for the whole page; the lookup caches a
    // token id permanently once it sees one, so this is a single round trip per
    // agent at most, and usually none.
    const tokenIds = await ctx.mintLookup.tokenIdsOf(visible.map((agent) => agent.agentId));

    const payload = await Promise.all(
      visible.map(async (agent) => {
        const run = agent.latestRunId ? await ctx.store.getRun(agent.latestRunId) : undefined;
        const anchor = run ? await ctx.store.getAnchor(run.id) : undefined;
        return toAgentDto(agent, run, anchor, tokenIds.get(agent.agentId));
      }),
    );

    res.json(payload);
  });

  router.post('/agents', async (req, res) => {
    const { name, family, owner, periodsPerYear, description } = req.body ?? {};

    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(422).json({ error: 'name is required', field: 'name' });
      return;
    }
    if (typeof family !== 'string' || family.trim().length === 0) {
      res.status(422).json({ error: 'family is required', field: 'family' });
      return;
    }
    if (typeof owner !== 'string' || owner.trim().length === 0) {
      res.status(422).json({ error: 'owner is required', field: 'owner' });
      return;
    }

    // The on-chain identity is derived from an address. Owners given as a handle
    // rather than an address still need a stable key, so the handle is hashed into
    // a deterministic pseudo-address instead of being rejected.
    const ownerAddress = /^0x[0-9a-fA-F]{40}$/.test(owner.trim())
      ? owner.trim()
      : `0x${Buffer.from(owner.trim()).toString('hex').padEnd(40, '0').slice(0, 40)}`;

    const agentId = ctx.deriveAgentId(ownerAddress, name.trim());
    const existing = await ctx.store.getAgentByAgentId(agentId);
    if (existing) {
      res.status(422).json({
        error: `an agent named "${name.trim()}" already exists for this owner`,
        field: 'name',
      });
      return;
    }

    const now = new Date().toISOString();
    const agent = await ctx.store.createAgent({
      id: newId('agt'),
      agentId,
      name: name.trim(),
      family: family.trim(),
      owner: owner.trim(),
      periodsPerYear: Number.isFinite(periodsPerYear) && periodsPerYear > 0 ? periodsPerYear : 252,
      status: 'unverified',
      accent: accentFor(agentId),
      description: typeof description === 'string' && description.trim() ? description.trim() : undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.audit({
      actor: agent.owner,
      action: 'Registered agent',
      detail: `${agent.name} · ${agent.family}`,
      tone: 'neutral',
    });

    res.status(201).json(toAgentDto(agent));
  });

  router.get('/agents/:agentId', async (req, res) => {
    const agent = await ctx.store.getAgent(req.params.agentId!);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    const runs = await ctx.store.listRuns(agent.id);
    const latest = agent.latestRunId ? runs.find((run) => run.id === agent.latestRunId) : runs[0];
    const anchor = latest ? await ctx.store.getAnchor(latest.id) : undefined;

    const runDtos = await Promise.all(
      runs.map(async (run) => toRunDto(run, agent, await ctx.store.getAnchor(run.id))),
    );

    const tokenId = await ctx.mintLookup.tokenIdOf(agent.agentId);
    res.json({ ...toAgentDto(agent, latest, anchor, tokenId), runs: runDtos });
  });

  // Two megabytes. Artwork this size already renders well, and every byte is
  // published to 0G Storage and paid for.
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

  router.post('/agents/:agentId/image', async (req, res) => {
    const agent = await ctx.store.getAgent(req.params.agentId!);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    const { contentType, dataBase64, filename } = req.body ?? {};

    if (typeof contentType !== 'string' || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
      res.status(422).json({
        error: `contentType must be one of ${ALLOWED_IMAGE_TYPES.join(', ')}`,
        field: 'contentType',
      });
      return;
    }
    if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
      res.status(422).json({ error: 'dataBase64 is required', field: 'dataBase64' });
      return;
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(dataBase64, 'base64');
    } catch {
      res.status(422).json({ error: 'dataBase64 is not valid base64', field: 'dataBase64' });
      return;
    }
    if (bytes.byteLength === 0) {
      res.status(422).json({ error: 'the decoded image is empty', field: 'dataBase64' });
      return;
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      res.status(422).json({
        error: `image is ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB; the limit is 2 MB`,
        field: 'dataBase64',
      });
      return;
    }

    // The extension is how a browser and an explorer infer the type from the
    // gateway URL, so it is derived from contentType rather than trusted from
    // whatever the client called the file.
    const extension = contentType === 'image/svg+xml' ? 'svg' : contentType.split('/')[1];
    const name = `${agent.name.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase()}.${extension}`;

    const upload = await ctx.storage.upload(new Uint8Array(bytes), filename ?? name);
    const url = ctx.storage.gatewayUrl(upload.rootHash, name);

    await ctx.store.updateAgent(agent.id, { imageRoot: upload.rootHash, imageUrl: url });
    await ctx.audit({
      actor: agent.owner,
      action: url ? 'Artwork published to 0G Storage' : 'Artwork sealed locally',
      detail: `${agent.name} · ${upload.rootHash.slice(0, 18)}… · ${bytes.byteLength.toLocaleString()} bytes`,
      tone: url ? 'good' : 'neutral',
    });

    res.json({
      root: upload.rootHash,
      url,
      bytes: bytes.byteLength,
      storageMode: upload.mode,
    });
  });

  router.get('/agents/:agentId/mint-intent', async (req, res) => {
    const agent = await ctx.store.getAgent(req.params.agentId!);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    const run = agent.latestRunId ? await ctx.store.getRun(agent.latestRunId) : undefined;
    const anchor = run ? await ctx.store.getAnchor(run.id) : undefined;

    // Someone asking whether they can mint is often about to; drop any cached
    // "no token yet" so the next list reflects the result immediately.
    ctx.mintLookup.forget(agent.agentId);

    res.json(buildMintIntent({ agent, run, anchor, chain: ctx.chain.status() }));
  });

  router.post('/agents/:agentId/verify', async (req, res) => {
    const agent = await ctx.store.getAgent(req.params.agentId!);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    // A root, not a bundle. The claimant publishes their own evidence and pays
    // for it; what arrives here is the address of those bytes on 0G Storage.
    // Accepting the CSVs directly would let a submission name one bundle on
    // chain while being measured against another.
    const { evidenceRoot } = req.body ?? {};

    let published;
    try {
      published = await fetchPublishedEvidence(ctx.storage, evidenceRoot);
    } catch (error) {
      if (error instanceof PublishedEvidenceError) {
        res.status(error.status).json({ error: error.message, field: error.field });
        return;
      }
      throw error;
    }

    await ctx.audit({
      actor: agent.owner,
      action: 'Evidence published to 0G Storage',
      detail:
        `${agent.name} · root ${published.evidenceRoot.slice(0, 18)}… · ` +
        `${published.bytes.toLocaleString()} bytes · funded by the claimant`,
      tone: 'good',
    });

    try {
      const run = await ctx.verification.start(agent, {
        returnsCsv: published.returnsCsv,
        trialsCsv: published.trialsCsv,
        selectedColumn: published.selectedColumn,
        evidenceRoot: published.evidenceRoot,
      });
      res.status(202).json(toRunDto(run, agent));
    } catch (error) {
      if (error instanceof EvidenceRequestError) {
        res.status(error.status).json({ error: error.message, field: error.field });
        return;
      }
      throw error;
    }
  });

  return router;
}
