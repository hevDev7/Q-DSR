import { expect } from 'chai';
import { ethers } from 'hardhat';

const EVIDENCE_ROOT = ethers.keccak256(ethers.toUtf8Bytes('evidence-root'));
const RESULT_DIGEST = ethers.keccak256(ethers.toUtf8Bytes('result-digest'));
const METADATA_HASH = ethers.keccak256(ethers.toUtf8Bytes('encrypted-metadata'));
const ENCRYPTED_URI = '0g://storage/0x9f2c…/agent.enc';
const ENGINE = 'qdsr-core/1.0.0';

const CERTIFIED = [9_800n, 400n, 60n, 756n] as const;
const OVERFIT = [40n, 5_839n, 60n, 756n] as const;

async function deploy() {
  const [owner, holder, recipient, outsider] = await ethers.getSigners();

  const registryFactory = await ethers.getContractFactory('QDSRRegistry');
  const registry = await registryFactory.deploy(owner!.address);
  await registry.waitForDeployment();

  const agenticFactory = await ethers.getContractFactory('AgenticID');
  const agentic = await agenticFactory.deploy(await registry.getAddress());
  await agentic.waitForDeployment();

  const certifiedAgent = ethers.keccak256(ethers.toUtf8Bytes('vega-lantern'));
  const overfitAgent = ethers.keccak256(ethers.toUtf8Bytes('juniper-flow'));

  await registry.submitVerdict(certifiedAgent, EVIDENCE_ROOT, RESULT_DIGEST, ENGINE, ...CERTIFIED);
  await registry.submitVerdict(overfitAgent, EVIDENCE_ROOT, RESULT_DIGEST, ENGINE, ...OVERFIT);

  const proofFor = (agentId: string) =>
    ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], [agentId]);

  return {
    registry,
    agentic,
    owner: owner!,
    holder: holder!,
    recipient: recipient!,
    outsider: outsider!,
    certifiedAgent,
    overfitAgent,
    proofFor,
  };
}

describe('AgenticID', () => {
  describe('the certification gate', () => {
    it('mints for an agent that survived Q-DSR', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();
      await expect(
        agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH),
      ).to.emit(agentic, 'AgenticIdMinted');

      expect(await agentic.ownerOf(1)).to.equal(holder.address);
      expect(await agentic.totalMinted()).to.equal(1n);
    });

    it('blocks the mint for an overfit agent', async () => {
      // This is the whole protocol in one assertion: a strategy that cannot pass
      // PBO and DSR does not get an on-chain identity at all.
      const { agentic, holder, overfitAgent } = await deploy();
      await expect(
        agentic.mint(holder.address, overfitAgent, ENCRYPTED_URI, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'AgentNotCertified');

      expect(await agentic.totalMinted()).to.equal(0n);
    });

    it('blocks the mint for an agent that was never verified at all', async () => {
      const { agentic, holder } = await deploy();
      const unknown = ethers.keccak256(ethers.toUtf8Bytes('never-submitted'));
      await expect(
        agentic.mint(holder.address, unknown, ENCRYPTED_URI, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'AgentNotCertified');
    });

    it('lets anyone mint for a certified agent — the statistical gate is the only gate', async () => {
      const { agentic, outsider, recipient, certifiedAgent } = await deploy();
      await expect(
        agentic.connect(outsider).mint(recipient.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH),
      ).to.emit(agentic, 'AgenticIdMinted');
    });

    it('opens the gate once a failing agent is re-verified and passes', async () => {
      const { registry, agentic, holder, overfitAgent } = await deploy();
      await expect(
        agentic.mint(holder.address, overfitAgent, ENCRYPTED_URI, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'AgentNotCertified');

      await registry.submitVerdict(overfitAgent, EVIDENCE_ROOT, RESULT_DIGEST, ENGINE, ...CERTIFIED);

      await expect(
        agentic.mint(holder.address, overfitAgent, ENCRYPTED_URI, METADATA_HASH),
      ).to.emit(agentic, 'AgenticIdMinted');
      // ...and the earlier failure is still on the record.
      expect(await registry.hasFailedVerdict(overfitAgent)).to.equal(true);
    });

    it('refuses a second identity for the same agent', async () => {
      const { agentic, holder, recipient, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH);
      await expect(
        agentic.mint(recipient.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'AgentAlreadyMinted');
    });

    it('rejects empty metadata', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();
      await expect(
        agentic.mint(holder.address, certifiedAgent, '', METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'EmptyMetadata');
      await expect(
        agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(agentic, 'EmptyMetadata');
    });

    it('rejects the zero address', async () => {
      const { agentic, certifiedAgent } = await deploy();
      await expect(
        agentic.mint(ethers.ZeroAddress, certifiedAgent, ENCRYPTED_URI, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'ZeroAddress');
    });
  });

  describe('records', () => {
    it('stores what the token stands for', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH);

      const record = await agentic.recordOf(1);
      expect(record.agentId).to.equal(certifiedAgent);
      expect(record.metadataHash).to.equal(METADATA_HASH);
      expect(await agentic.encryptedURI(1)).to.equal(ENCRYPTED_URI);
      expect(await agentic.tokenIdOfAgent(certifiedAgent)).to.equal(1n);
    });

    it('reports whether the agent still holds a passing verdict', async () => {
      const { agentic, registry, holder, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH);
      expect(await agentic.isStillCertified(1)).to.equal(true);

      // A later re-verification that fails revokes the standing, without burning
      // the token — the record tells the truth even after the fact.
      await registry.submitVerdict(certifiedAgent, EVIDENCE_ROOT, RESULT_DIGEST, ENGINE, ...OVERFIT);
      expect(await agentic.isStillCertified(1)).to.equal(false);
    });

    it('reverts for an unknown token', async () => {
      const { agentic } = await deploy();
      await expect(agentic.recordOf(99)).to.be.revertedWithCustomError(agentic, 'UnknownToken');
    });
  });

  describe('ERC-7857 sealed operations', () => {
    it('transfers with a re-sealed key and a valid oracle proof', async () => {
      const { agentic, holder, recipient, certifiedAgent, proofFor } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH);

      const sealedKey = ethers.toUtf8Bytes('sealed-for-recipient');
      await expect(
        agentic
          .connect(holder)
          .transfer(holder.address, recipient.address, 1, sealedKey, proofFor(certifiedAgent)),
      ).to.emit(agentic, 'SealedTransfer');

      expect(await agentic.ownerOf(1)).to.equal(recipient.address);
    });

    it('refuses a transfer whose oracle proof points at an uncertified agent', async () => {
      const { agentic, holder, recipient, certifiedAgent, overfitAgent, proofFor } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH);

      await expect(
        agentic
          .connect(holder)
          .transfer(
            holder.address,
            recipient.address,
            1,
            ethers.toUtf8Bytes('sealed'),
            proofFor(overfitAgent),
          ),
      ).to.be.revertedWithCustomError(agentic, 'InvalidProof');
    });

    it('refuses a transfer without a sealed key', async () => {
      const { agentic, holder, recipient, certifiedAgent, proofFor } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH);
      await expect(
        agentic
          .connect(holder)
          .transfer(holder.address, recipient.address, 1, '0x', proofFor(certifiedAgent)),
      ).to.be.revertedWithCustomError(agentic, 'EmptySealedKey');
    });

    it('refuses a transfer initiated by someone who does not hold the token', async () => {
      const { agentic, holder, recipient, outsider, certifiedAgent, proofFor } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH);
      await expect(
        agentic
          .connect(outsider)
          .transfer(
            holder.address,
            recipient.address,
            1,
            ethers.toUtf8Bytes('sealed'),
            proofFor(certifiedAgent),
          ),
      ).to.be.revertedWithCustomError(agentic, 'NotTokenOwner');
    });

    it('clones an agent, carrying its certification with it', async () => {
      const { agentic, holder, recipient, certifiedAgent, proofFor } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH);

      await expect(
        agentic
          .connect(holder)
          .clone(recipient.address, 1, ethers.toUtf8Bytes('sealed'), proofFor(certifiedAgent)),
      ).to.emit(agentic, 'Cloned');

      expect(await agentic.ownerOf(2)).to.equal(recipient.address);
      const clone = await agentic.recordOf(2);
      expect(clone.agentId).to.equal(certifiedAgent);
      expect(await agentic.encryptedURI(2)).to.equal(ENCRYPTED_URI);
    });

    it('authorises an executor without transferring ownership', async () => {
      const { agentic, holder, outsider, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH);

      const permissions = ethers.toUtf8Bytes('read:signals');
      await expect(agentic.connect(holder).authorizeUsage(1, outsider.address, permissions)).to.emit(
        agentic,
        'UsageAuthorised',
      );

      expect(await agentic.authorisationOf(1, outsider.address)).to.equal(
        ethers.hexlify(permissions),
      );
      expect(await agentic.ownerOf(1)).to.equal(holder.address);
    });

    it('stops a non-holder from authorising executors', async () => {
      const { agentic, holder, outsider, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, ENCRYPTED_URI, METADATA_HASH);
      await expect(
        agentic.connect(outsider).authorizeUsage(1, outsider.address, ethers.toUtf8Bytes('x')),
      ).to.be.revertedWithCustomError(agentic, 'NotTokenOwner');
    });
  });

  describe('interface detection', () => {
    it('reports name and symbol', async () => {
      const { agentic } = await deploy();
      expect(await agentic.name()).to.equal('Q-DSR Agentic ID');
      expect(await agentic.symbol()).to.equal('QAID');
    });

    it('supports ERC-165 and ERC-721', async () => {
      const { agentic } = await deploy();
      expect(await agentic.supportsInterface('0x01ffc9a7')).to.equal(true);
      expect(await agentic.supportsInterface('0x80ac58cd')).to.equal(true);
    });

    it('advertises the ERC-7857 interface, so it is detectable as more than an ERC-721', async () => {
      // An explorer will still print "ERC-721", because explorers match the
      // standards they have implemented and ERC-7857 is a draft. This is for
      // contracts and indexers, which can ask.
      const { agentic } = await deploy();
      const id = await agentic.ERC7857_INTERFACE_ID();
      expect(await agentic.supportsInterface(id)).to.equal(true);
    });

    it('derives that id from the three functions ERC-7857 adds', async () => {
      const { agentic } = await deploy();
      const iface = new ethers.Interface([
        'function transfer(address,address,uint256,bytes,bytes)',
        'function clone(address,uint256,bytes,bytes) returns (uint256)',
        'function authorizeUsage(uint256,address,bytes)',
      ]);
      const xor = ['transfer', 'clone', 'authorizeUsage']
        .map((n) => BigInt(iface.getFunction(n)!.selector))
        .reduce((a, b) => a ^ b);
      const expected = ethers.zeroPadValue(ethers.toBeHex(xor), 4);

      expect(await agentic.ERC7857_INTERFACE_ID()).to.equal(expected);
    });

    it('still answers false for a standard it does not implement', async () => {
      const { agentic } = await deploy();
      expect(await agentic.supportsInterface('0xd9b67a26')).to.equal(false); // ERC-1155
    });
  });
});
