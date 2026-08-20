import { expect } from 'chai';
import { ethers } from 'hardhat';

const CERTIFIED = {
  dsrBps: 9_800n,
  pboBps: 400n,
  trials: 60n,
  observations: 756n,
};

const OVERFIT = {
  dsrBps: 40n,
  pboBps: 5_839n,
  trials: 60n,
  observations: 756n,
};

const EVIDENCE_ROOT = ethers.keccak256(ethers.toUtf8Bytes('evidence-root'));
const RESULT_DIGEST = ethers.keccak256(ethers.toUtf8Bytes('result-digest'));
const ENGINE = 'qdsr-core/1.0.0';

async function deploy() {
  const [owner, attestor, outsider] = await ethers.getSigners();
  const factory = await ethers.getContractFactory('QDSRRegistry');
  const registry = await factory.deploy(attestor!.address);
  await registry.waitForDeployment();
  const agentId = ethers.keccak256(ethers.toUtf8Bytes('cinder-delta'));
  return { registry, owner: owner!, attestor: attestor!, outsider: outsider!, agentId };
}

function submit(
  registry: any,
  signer: any,
  agentId: string,
  metrics: typeof CERTIFIED,
  overrides: Partial<{ evidenceRoot: string; resultDigest: string; engine: string }> = {},
) {
  return registry
    .connect(signer)
    .submitVerdict(
      agentId,
      overrides.evidenceRoot ?? EVIDENCE_ROOT,
      overrides.resultDigest ?? RESULT_DIGEST,
      overrides.engine ?? ENGINE,
      metrics.dsrBps,
      metrics.pboBps,
      metrics.trials,
      metrics.observations,
    );
}

describe('QDSRRegistry', () => {
  describe('deployment', () => {
    it('publishes the certification bar as on-chain constants', async () => {
      const { registry } = await deploy();
      expect(await registry.MIN_DSR_BPS()).to.equal(9_500n);
      expect(await registry.MAX_PBO_BPS()).to.equal(1_000n);
      expect(await registry.MIN_OBSERVATIONS()).to.equal(252n);
      expect(await registry.MIN_TRIALS()).to.equal(2n);
    });

    it('authorises the initial attestor', async () => {
      const { registry, attestor } = await deploy();
      expect(await registry.isAttestor(attestor.address)).to.equal(true);
    });

    it('falls back to the deployer when no attestor is supplied', async () => {
      const [owner] = await ethers.getSigners();
      const factory = await ethers.getContractFactory('QDSRRegistry');
      const registry = await factory.deploy(ethers.ZeroAddress);
      await registry.waitForDeployment();
      expect(await registry.isAttestor(owner!.address)).to.equal(true);
    });
  });

  describe('access control', () => {
    it('rejects a verdict from an unauthorised account', async () => {
      const { registry, outsider, agentId } = await deploy();
      await expect(submit(registry, outsider, agentId, CERTIFIED)).to.be.revertedWithCustomError(
        registry,
        'NotAttestor',
      );
    });

    it('lets the owner add and remove attestors', async () => {
      const { registry, owner, outsider, agentId } = await deploy();
      await registry.connect(owner).setAttestor(outsider.address, true);
      await expect(submit(registry, outsider, agentId, CERTIFIED)).to.emit(
        registry,
        'VerdictSubmitted',
      );

      await registry.connect(owner).setAttestor(outsider.address, false);
      await expect(submit(registry, outsider, agentId, CERTIFIED)).to.be.revertedWithCustomError(
        registry,
        'NotAttestor',
      );
    });

    it('stops a non-owner from granting themselves attestor rights', async () => {
      const { registry, outsider } = await deploy();
      await expect(
        registry.connect(outsider).setAttestor(outsider.address, true),
      ).to.be.revertedWithCustomError(registry, 'NotOwner');
    });
  });

  describe('the certification rule lives on-chain', () => {
    it('certifies metrics that clear every gate', async () => {
      const { registry, attestor, agentId } = await deploy();
      await submit(registry, attestor, agentId, CERTIFIED);
      expect(await registry.isCertified(agentId)).to.equal(true);
    });

    it('refuses to certify an overfit result even though the attestor submitted it', async () => {
      // The attestor reports measurements; the contract applies the rule. There is
      // no boolean an attestor can set to force a pass.
      const { registry, attestor, agentId } = await deploy();
      await submit(registry, attestor, agentId, OVERFIT);
      expect(await registry.isCertified(agentId)).to.equal(false);
    });

    it('fails an agent whose DSR is one basis point short', async () => {
      const { registry, attestor, agentId } = await deploy();
      await submit(registry, attestor, agentId, { ...CERTIFIED, dsrBps: 9_499n });
      expect(await registry.isCertified(agentId)).to.equal(false);
    });

    it('fails an agent whose PBO is one basis point over', async () => {
      const { registry, attestor, agentId } = await deploy();
      await submit(registry, attestor, agentId, { ...CERTIFIED, pboBps: 1_001n });
      expect(await registry.isCertified(agentId)).to.equal(false);
    });

    it('fails a track record shorter than a trading year', async () => {
      const { registry, attestor, agentId } = await deploy();
      await submit(registry, attestor, agentId, { ...CERTIFIED, observations: 251n });
      expect(await registry.isCertified(agentId)).to.equal(false);
    });

    it('fails a single-trial submission', async () => {
      const { registry, attestor, agentId } = await deploy();
      await submit(registry, attestor, agentId, { ...CERTIFIED, trials: 1n });
      expect(await registry.isCertified(agentId)).to.equal(false);
    });
  });

  describe('input validation', () => {
    it('rejects an empty agent id', async () => {
      const { registry, attestor } = await deploy();
      await expect(
        submit(registry, attestor, ethers.ZeroHash, CERTIFIED),
      ).to.be.revertedWithCustomError(registry, 'EmptyAgentId');
    });

    it('rejects a missing evidence root', async () => {
      const { registry, attestor, agentId } = await deploy();
      await expect(
        submit(registry, attestor, agentId, CERTIFIED, { evidenceRoot: ethers.ZeroHash }),
      ).to.be.revertedWithCustomError(registry, 'MissingEvidenceRoot');
    });

    it('rejects a missing result digest', async () => {
      const { registry, attestor, agentId } = await deploy();
      await expect(
        submit(registry, attestor, agentId, CERTIFIED, { resultDigest: ethers.ZeroHash }),
      ).to.be.revertedWithCustomError(registry, 'MissingResultDigest');
    });

    it('rejects a probability above 100%', async () => {
      const { registry, attestor, agentId } = await deploy();
      await expect(
        submit(registry, attestor, agentId, { ...CERTIFIED, dsrBps: 10_001n }),
      ).to.be.revertedWithCustomError(registry, 'MetricOutOfRange');
    });
  });

  describe('the record is permanent', () => {
    it('appends rather than overwrites', async () => {
      const { registry, attestor, agentId } = await deploy();
      await submit(registry, attestor, agentId, OVERFIT);
      await submit(registry, attestor, agentId, CERTIFIED);

      expect(await registry.verdictCount(agentId)).to.equal(2n);
      expect(await registry.isCertified(agentId)).to.equal(true);
      // The failure never disappears.
      expect(await registry.hasFailedVerdict(agentId)).to.equal(true);

      const first = await registry.verdictAt(agentId, 0);
      expect(first.certified).to.equal(false);
      expect(first.pboBps).to.equal(OVERFIT.pboBps);
    });

    it('reports the latest verdict', async () => {
      const { registry, attestor, agentId } = await deploy();
      await submit(registry, attestor, agentId, CERTIFIED);
      const latest = await registry.latestVerdict(agentId);
      expect(latest.dsrBps).to.equal(CERTIFIED.dsrBps);
      expect(latest.attestor).to.equal(attestor.address);
      expect(latest.engineVersionHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(ENGINE)));
    });

    it('reverts when asked for a verdict that does not exist', async () => {
      const { registry, agentId } = await deploy();
      await expect(registry.latestVerdict(agentId)).to.be.revertedWithCustomError(
        registry,
        'NoVerdict',
      );
      await expect(registry.verdictAt(agentId, 0)).to.be.revertedWithCustomError(
        registry,
        'IndexOutOfBounds',
      );
    });

    it('treats an unknown agent as uncertified rather than reverting', async () => {
      const { registry } = await deploy();
      const unknown = ethers.keccak256(ethers.toUtf8Bytes('never-submitted'));
      expect(await registry.isCertified(unknown)).to.equal(false);
    });

    it('emits the full result in its event, including the engine version string', async () => {
      const { registry, attestor, agentId } = await deploy();
      await expect(submit(registry, attestor, agentId, CERTIFIED))
        .to.emit(registry, 'VerdictSubmitted')
        .withArgs(
          agentId,
          0n,
          true,
          CERTIFIED.dsrBps,
          CERTIFIED.pboBps,
          EVIDENCE_ROOT,
          RESULT_DIGEST,
          ENGINE,
        );
    });
  });

  describe('IOracle', () => {
    it('answers verifyProof for a certified agent', async () => {
      const { registry, attestor, agentId } = await deploy();
      await submit(registry, attestor, agentId, CERTIFIED);
      const proof = ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], [agentId]);
      expect(await registry.verifyProof(proof)).to.equal(true);
    });

    it('answers false for an overfit agent', async () => {
      const { registry, attestor, agentId } = await deploy();
      await submit(registry, attestor, agentId, OVERFIT);
      const proof = ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], [agentId]);
      expect(await registry.verifyProof(proof)).to.equal(false);
    });

    it('rejects a malformed proof', async () => {
      const { registry } = await deploy();
      await expect(registry.verifyProof('0x1234')).to.be.revertedWithCustomError(
        registry,
        'MalformedProof',
      );
    });
  });

  describe('deriveAgentId', () => {
    it('matches the client-side derivation', async () => {
      const { registry, owner } = await deploy();
      const onChain = await registry.deriveAgentId(owner.address, 'Cinder Delta');
      const offChain = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'string'],
          [owner.address, 'Cinder Delta'],
        ),
      );
      expect(onChain).to.equal(offChain);
    });
  });
});

/** Regressions from the pre-mainnet audit. */
describe('QDSRRegistry — audit regressions', () => {
  describe('hasFailedVerdict does not walk the history', () => {
    it('costs the same after fifty verdicts as after one', async () => {
      const { registry, attestor, agentId } = await deploy();

      await submit(registry, attestor, agentId, OVERFIT);
      const first = await registry.hasFailedVerdict.estimateGas(agentId);

      // History is append-only with no cap. The old implementation scanned it
      // linearly, so an agent could push its own rejection out of reach of any
      // on-chain caller simply by resubmitting.
      for (let i = 0; i < 49; i++) {
        await submit(registry, attestor, agentId, OVERFIT, {
          resultDigest: ethers.keccak256(ethers.toUtf8Bytes(`digest-${i}`)),
        });
      }

      const later = await registry.hasFailedVerdict.estimateGas(agentId);

      expect(await registry.verdictCount(agentId)).to.equal(50n);
      expect(later).to.equal(first);
    });

    it('still reports a failure that a later pass does not erase', async () => {
      const { registry, attestor, agentId } = await deploy();

      await submit(registry, attestor, agentId, OVERFIT);
      await submit(registry, attestor, agentId, CERTIFIED, {
        resultDigest: ethers.keccak256(ethers.toUtf8Bytes('second-run')),
      });

      // Certified now, but the rejection stays on the record — that permanence
      // is the product.
      expect(await registry.isCertified(agentId)).to.equal(true);
      expect(await registry.hasFailedVerdict(agentId)).to.equal(true);
    });

    it('reports no failure for an agent that never failed', async () => {
      const { registry, attestor, agentId } = await deploy();

      await submit(registry, attestor, agentId, CERTIFIED);

      expect(await registry.hasFailedVerdict(agentId)).to.equal(false);
    });

    it('reports no failure for an agent nobody has submitted', async () => {
      const { registry } = await deploy();

      expect(
        await registry.hasFailedVerdict(ethers.keccak256(ethers.toUtf8Bytes('nobody'))),
      ).to.equal(false);
    });
  });

  describe('ownership handover takes two steps', () => {
    it('does not move on nomination alone', async () => {
      const { registry, owner, outsider } = await deploy();

      // A single-step transfer to an address that cannot transact would strand
      // setAttestor forever — this contract is immutable and has no recovery.
      await expect(registry.transferOwnership(outsider.address)).to.emit(
        registry,
        'OwnershipTransferStarted',
      );

      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.pendingOwner()).to.equal(outsider.address);
    });

    it('keeps the incumbent’s powers until the nominee accepts', async () => {
      const { registry, owner, outsider, attestor } = await deploy();

      await registry.transferOwnership(outsider.address);

      await expect(registry.setAttestor(attestor.address, false)).to.emit(
        registry,
        'AttestorUpdated',
      );
      await expect(
        registry.connect(outsider).setAttestor(owner.address, true),
      ).to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('moves once the nominee accepts', async () => {
      const { registry, outsider } = await deploy();

      await registry.transferOwnership(outsider.address);
      await expect(registry.connect(outsider).acceptOwnership()).to.emit(
        registry,
        'OwnershipTransferred',
      );

      expect(await registry.owner()).to.equal(outsider.address);
      expect(await registry.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it('lets nobody else accept', async () => {
      const { registry, attestor, outsider } = await deploy();

      await registry.transferOwnership(outsider.address);
      await expect(
        registry.connect(attestor).acceptOwnership(),
      ).to.be.revertedWithCustomError(registry, 'NotPendingOwner');
    });

    it('lets the owner withdraw a nomination by naming someone else', async () => {
      const { registry, attestor, outsider } = await deploy();

      await registry.transferOwnership(outsider.address);
      await registry.transferOwnership(attestor.address);

      await expect(
        registry.connect(outsider).acceptOwnership(),
      ).to.be.revertedWithCustomError(registry, 'NotPendingOwner');
      expect(await registry.pendingOwner()).to.equal(attestor.address);
    });
  });
});
