import { expect } from 'chai';
import { ethers } from 'hardhat';

const EVIDENCE_ROOT = ethers.keccak256(ethers.toUtf8Bytes('evidence-root'));
const RESULT_DIGEST = ethers.keccak256(ethers.toUtf8Bytes('result-digest'));
const METADATA_HASH = ethers.keccak256(ethers.toUtf8Bytes('encrypted-metadata'));
const ENCRYPTED_URI = '0g://storage/0x9f2c';
const META = {
  name: 'Vega Lantern',
  description: 'Options volatility strategy on ETH, certified under Q-DSR.',
  image: '',
  evidenceURI: '0g://storage/0x9f2c',
};

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
        agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH),
      ).to.emit(agentic, 'AgenticIdMinted');

      expect(await agentic.ownerOf(1)).to.equal(holder.address);
      expect(await agentic.totalMinted()).to.equal(1n);
    });

    it('blocks the mint for an overfit agent', async () => {
      // This is the whole protocol in one assertion: a strategy that cannot pass
      // PBO and DSR does not get an on-chain identity at all.
      const { agentic, holder, overfitAgent } = await deploy();
      await expect(
        agentic.mint(holder.address, overfitAgent, META, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'AgentNotCertified');

      expect(await agentic.totalMinted()).to.equal(0n);
    });

    it('blocks the mint for an agent that was never verified at all', async () => {
      const { agentic, holder } = await deploy();
      const unknown = ethers.keccak256(ethers.toUtf8Bytes('never-submitted'));
      await expect(
        agentic.mint(holder.address, unknown, META, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'AgentNotCertified');
    });

    it('lets anyone mint for a certified agent — the statistical gate is the only gate', async () => {
      const { agentic, outsider, recipient, certifiedAgent } = await deploy();
      await expect(
        agentic.connect(outsider).mint(recipient.address, certifiedAgent, META, METADATA_HASH),
      ).to.emit(agentic, 'AgenticIdMinted');
    });

    it('opens the gate once a failing agent is re-verified and passes', async () => {
      const { registry, agentic, holder, overfitAgent } = await deploy();
      await expect(
        agentic.mint(holder.address, overfitAgent, META, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'AgentNotCertified');

      await registry.submitVerdict(overfitAgent, EVIDENCE_ROOT, RESULT_DIGEST, ENGINE, ...CERTIFIED);

      await expect(
        agentic.mint(holder.address, overfitAgent, META, METADATA_HASH),
      ).to.emit(agentic, 'AgenticIdMinted');
      // ...and the earlier failure is still on the record.
      expect(await registry.hasFailedVerdict(overfitAgent)).to.equal(true);
    });

    it('refuses a second identity for the same agent', async () => {
      const { agentic, holder, recipient, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
      await expect(
        agentic.mint(recipient.address, certifiedAgent, META, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'AgentAlreadyMinted');
    });

    it('rejects empty metadata', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();
      await expect(
        agentic.mint(holder.address, certifiedAgent, { ...META, evidenceURI: '' }, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'EmptyMetadata');
      await expect(
        agentic.mint(holder.address, certifiedAgent, META, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(agentic, 'EmptyMetadata');
    });

    it('rejects the zero address', async () => {
      const { agentic, certifiedAgent } = await deploy();
      await expect(
        agentic.mint(ethers.ZeroAddress, certifiedAgent, META, METADATA_HASH),
      ).to.be.revertedWithCustomError(agentic, 'ZeroAddress');
    });
  });

  describe('records', () => {
    it('stores what the token stands for', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);

      const record = await agentic.recordOf(1);
      expect(record.agentId).to.equal(certifiedAgent);
      expect(record.metadataHash).to.equal(METADATA_HASH);
      expect((await agentic.metadataOf(1)).evidenceURI).to.equal(META.evidenceURI);
      expect(await agentic.tokenIdOfAgent(certifiedAgent)).to.equal(1n);
    });

    it('reports whether the agent still holds a passing verdict', async () => {
      const { agentic, registry, holder, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
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
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);

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
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);

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
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
      await expect(
        agentic
          .connect(holder)
          .transfer(holder.address, recipient.address, 1, '0x', proofFor(certifiedAgent)),
      ).to.be.revertedWithCustomError(agentic, 'EmptySealedKey');
    });

    it('refuses a transfer initiated by someone who does not hold the token', async () => {
      const { agentic, holder, recipient, outsider, certifiedAgent, proofFor } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
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
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);

      await expect(
        agentic
          .connect(holder)
          .clone(recipient.address, 1, ethers.toUtf8Bytes('sealed'), proofFor(certifiedAgent)),
      ).to.emit(agentic, 'Cloned');

      expect(await agentic.ownerOf(2)).to.equal(recipient.address);
      const clone = await agentic.recordOf(2);
      expect(clone.agentId).to.equal(certifiedAgent);
      expect((await agentic.metadataOf(2)).evidenceURI).to.equal(META.evidenceURI);
    });

    it('authorises an executor without transferring ownership', async () => {
      const { agentic, holder, outsider, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);

      const permissions = ethers.toUtf8Bytes('read:signals');
      await expect(agentic.connect(holder).authorizeUsage(1, outsider.address, permissions)).to.emit(
        agentic,
        'UsageAuthorized',
      );

      expect(await agentic.authorisationOf(1, outsider.address)).to.equal(
        ethers.hexlify(permissions),
      );
      expect(await agentic.ownerOf(1)).to.equal(holder.address);
    });

    it('stops a non-holder from authorising executors', async () => {
      const { agentic, holder, outsider, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
      await expect(
        agentic.connect(outsider).authorizeUsage(1, outsider.address, ethers.toUtf8Bytes('x')),
      ).to.be.revertedWithCustomError(agentic, 'NotTokenOwner');
    });
  });

  describe('on-chain metadata', () => {
    async function decodeTokenUri(agentic: any, tokenId: number) {
      const uri: string = await agentic.tokenURI(tokenId);
      expect(uri.startsWith('data:application/json;base64,')).to.equal(true);
      return JSON.parse(Buffer.from(uri.split(',')[1]!, 'base64').toString('utf8'));
    }

    it('carries the certification numbers with the token', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
      const meta = await decodeTokenUri(agentic, 1);

      expect(meta.name).to.equal('Vega Lantern #1');
      expect(meta.description).to.equal(META.description);
      expect(meta.external_url).to.equal(META.evidenceURI);

      const traits = Object.fromEntries(meta.attributes.map((a: any) => [a.trait_type, a.value]));
      expect(traits['Verdict']).to.equal('Certified');
      expect(traits['Deflated Sharpe Ratio']).to.equal('0.9800');
      expect(traits['Probability of Backtest Overfitting']).to.equal('0.0400');
      expect(traits['Configurations tested']).to.equal(60);
      expect(traits['Observations']).to.equal(756);
    });

    it('generates an SVG when no image was supplied, so a token always renders', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
      const meta = await decodeTokenUri(agentic, 1);

      expect(meta.image.startsWith('data:image/svg+xml;base64,')).to.equal(true);
      const svg = Buffer.from(meta.image.split(',')[1]!, 'base64').toString('utf8');
      expect(svg).to.contain('Vega Lantern');
      expect(svg).to.contain('0.9800');
      expect(svg).to.contain('CERTIFIED');
    });

    it('uses the supplied image when there is one', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();
      const url = 'https://indexer-storage-testnet-turbo.0g.ai/file?root=0xabc&name=a.png';
      await agentic.mint(holder.address, certifiedAgent, { ...META, image: url }, METADATA_HASH);
      expect((await decodeTokenUri(agentic, 1)).image).to.equal(url);
    });

    it('reads the verdict live, so a revoked token stops claiming to be certified', async () => {
      const { agentic, registry, holder, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
      expect((await decodeTokenUri(agentic, 1)).attributes[0].value).to.equal('Certified');

      await registry.submitVerdict(certifiedAgent, EVIDENCE_ROOT, RESULT_DIGEST, ENGINE, ...OVERFIT);
      const after = await decodeTokenUri(agentic, 1);
      expect(after.attributes[0].value).to.equal('Not significant');
      expect(after.attributes[1].value).to.equal('0.0040');
    });

    it('escapes a name that would otherwise break the JSON', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();
      await agentic.mint(
        holder.address,
        certifiedAgent,
        { ...META, name: 'Quote " and \\ backslash' },
        METADATA_HASH,
      );
      const meta = await decodeTokenUri(agentic, 1);
      expect(meta.name).to.equal('Quote " and \\ backslash #1');
    });

    it('reverts for a token that does not exist', async () => {
      const { agentic } = await deploy();
      await expect(agentic.tokenURI(99)).to.be.reverted;
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

    it('keeps the sealed key rather than discarding it', async () => {
      // The standard's model is that the metadata key travels with the token,
      // re-encrypted for each new owner. Validating one and throwing it away
      // would be worse than not accepting one.
      const { agentic, holder, recipient, certifiedAgent, proofFor } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
      expect(await agentic.sealedKeyOf(1)).to.equal('0x');

      const sealed = ethers.hexlify(ethers.toUtf8Bytes('sealed-for-recipient'));
      await agentic
        .connect(holder)
        .transfer(holder.address, recipient.address, 1, sealed, proofFor(certifiedAgent));

      expect(await agentic.sealedKeyOf(1)).to.equal(sealed);
    });

    it('announces a new sealed key with MetadataUpdated', async () => {
      const { agentic, holder, recipient, certifiedAgent, proofFor } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
      const sealed = ethers.hexlify(ethers.toUtf8Bytes('sealed'));

      await expect(
        agentic
          .connect(holder)
          .transfer(holder.address, recipient.address, 1, sealed, proofFor(certifiedAgent)),
      )
        .to.emit(agentic, 'MetadataUpdated')
        .withArgs(1n, ethers.keccak256(sealed));
    });

    it('seals a clone under its own key, not the original', async () => {
      const { agentic, holder, recipient, certifiedAgent, proofFor } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);
      const forClone = ethers.hexlify(ethers.toUtf8Bytes('sealed-for-clone'));

      await agentic.connect(holder).clone(recipient.address, 1, forClone, proofFor(certifiedAgent));
      expect(await agentic.sealedKeyOf(2)).to.equal(forClone);
      expect(await agentic.sealedKeyOf(1)).to.equal('0x');
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

/**
 * Regressions from the pre-mainnet audit. Each test failed against the
 * contracts as they stood before the fix; the comments record what the old
 * behaviour actually was, so a future refactor that reintroduces it is caught
 * with an explanation rather than a bare assertion failure.
 */
describe('AgenticID — audit regressions', () => {
  const decodeTokenUri = (uri: string) => {
    expect(uri.startsWith('data:application/json;base64,')).to.equal(true);
    const json = Buffer.from(uri.split(',')[1]!, 'base64').toString('utf8');
    return JSON.parse(json) as { name: string; image: string };
  };

  const decodeSvg = (image: string) => {
    expect(image.startsWith('data:image/svg+xml;base64,')).to.equal(true);
    return Buffer.from(image.split(',')[1]!, 'base64').toString('utf8');
  };

  describe('markup injection through the agent name', () => {
    it('cannot break out of the SVG text node', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();

      // The old _escape handled only " and \ — the JSON metacharacters. Fed
      // into an XML context it let this name close the text node and open a
      // script tag that wallets and explorers would then render.
      const payload = '</text><script>alert(1)</script><text>';

      await agentic.mint(
        holder.address,
        certifiedAgent,
        { ...META, name: payload, image: '' },
        METADATA_HASH,
      );

      const svg = decodeSvg(decodeTokenUri(await agentic.tokenURI(1)).image);

      expect(svg).to.not.include('<script');
      expect(svg).to.not.include(payload);
      expect(svg).to.include('&lt;script&gt;');
    });

    it('escapes every predefined XML entity, ampersand first', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();

      await agentic.mint(
        holder.address,
        certifiedAgent,
        { ...META, name: `&<>"'`, image: '' },
        METADATA_HASH,
      );

      const svg = decodeSvg(decodeTokenUri(await agentic.tokenURI(1)).image);

      // &amp; must not itself become &amp;amp; — the ampersand is replaced
      // before the substitutions that introduce new ampersands.
      expect(svg).to.include('&amp;&lt;&gt;&quot;&apos;');
      expect(svg).to.not.include('&amp;amp;');
    });

    it('still escapes the name for JSON, which is a different context', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();

      await agentic.mint(
        holder.address,
        certifiedAgent,
        { ...META, name: 'Vega "Lantern" \\ v2', image: '' },
        METADATA_HASH,
      );

      // Parsing at all is the assertion: an unescaped quote would have made
      // the document invalid JSON.
      // The library appends the token number to the display name.
      expect(decodeTokenUri(await agentic.tokenURI(1)).name).to.equal(
        'Vega "Lantern" \\ v2 #1',
      );
    });

    it('drops control characters rather than emitting them raw', async () => {
      const { agentic, holder, certifiedAgent } = await deploy();

      // A raw newline inside a JSON string is a parse error, and a tokenURI
      // that no wallet can parse is unfixable on an immutable contract. Both
      // escapers drop these instead.
      await agentic.mint(
        holder.address,
        certifiedAgent,
        { ...META, name: 'Vega\nLantern\tv2', image: '' },
        METADATA_HASH,
      );

      const decoded = decodeTokenUri(await agentic.tokenURI(1));
      expect(decoded.name).to.equal('VegaLanternv2 #1');
      expect(decodeSvg(decoded.image)).to.include('VegaLanternv2');
    });
  });

  describe('the oracle proof is bound to the token', () => {
    it('rejects a transfer proving a different agent', async () => {
      const { agentic, registry, holder, recipient, certifiedAgent, proofFor } =
        await deploy();

      // A second certified agent. Its proof is perfectly valid — the oracle
      // accepts it — it simply is not this token's agent.
      const otherAgent = ethers.keccak256(ethers.toUtf8Bytes('another-agent'));
      await registry.submitVerdict(
        otherAgent,
        EVIDENCE_ROOT,
        RESULT_DIGEST,
        ENGINE,
        ...CERTIFIED,
      );

      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);

      await expect(
        agentic
          .connect(holder)
          .transfer(
            holder.address,
            recipient.address,
            1,
            ethers.toUtf8Bytes('sealed'),
            proofFor(otherAgent),
          ),
      ).to.be.revertedWithCustomError(agentic, 'InvalidProof');
    });

    it('rejects a clone proving a different agent', async () => {
      const { agentic, registry, holder, recipient, certifiedAgent, proofFor } =
        await deploy();

      const otherAgent = ethers.keccak256(ethers.toUtf8Bytes('another-agent'));
      await registry.submitVerdict(
        otherAgent,
        EVIDENCE_ROOT,
        RESULT_DIGEST,
        ENGINE,
        ...CERTIFIED,
      );

      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);

      await expect(
        agentic
          .connect(holder)
          .clone(recipient.address, 1, ethers.toUtf8Bytes('sealed'), proofFor(otherAgent)),
      ).to.be.revertedWithCustomError(agentic, 'InvalidProof');
    });

    it('rejects a proof that is not a bytes32 at all', async () => {
      const { agentic, holder, recipient, certifiedAgent } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);

      await expect(
        agentic
          .connect(holder)
          .transfer(
            holder.address,
            recipient.address,
            1,
            ethers.toUtf8Bytes('sealed'),
            '0xdeadbeef',
          ),
      ).to.be.revertedWithCustomError(agentic, 'InvalidProof');
    });

    it('still accepts the token’s own agent', async () => {
      const { agentic, holder, recipient, certifiedAgent, proofFor } = await deploy();
      await agentic.mint(holder.address, certifiedAgent, META, METADATA_HASH);

      await expect(
        agentic
          .connect(holder)
          .transfer(
            holder.address,
            recipient.address,
            1,
            ethers.toUtf8Bytes('sealed'),
            proofFor(certifiedAgent),
          ),
      ).to.emit(agentic, 'SealedTransfer');
    });
  });

  describe('state is written before the receiver callback', () => {
    it('shows a contract receiver the finished record', async () => {
      const { agentic, certifiedAgent } = await deploy();

      const probe = await (
        await ethers.getContractFactory('StateProbeReceiver')
      ).deploy();
      await probe.waitForDeployment();

      await agentic.mint(await probe.getAddress(), certifiedAgent, META, METADATA_HASH);

      expect(await probe.probed()).to.equal(true);

      // Both were zero before the fix: _safeMint ran ahead of the writes, so a
      // receiver that indexed the token during its own callback stored nothing.
      expect(await probe.seenAgentId()).to.equal(certifiedAgent);
      expect(await probe.seenReverseLookup()).to.equal(1n);
    });
  });

  describe('ownership handover takes two steps', () => {
    it('does not move on nomination alone', async () => {
      const { agentic, owner, outsider } = await deploy();

      await expect(agentic.transferOwnership(outsider.address)).to.emit(
        agentic,
        'OwnershipTransferStarted',
      );

      expect(await agentic.owner()).to.equal(owner.address);
      expect(await agentic.pendingOwner()).to.equal(outsider.address);
    });

    it('moves once the nominee accepts', async () => {
      const { agentic, outsider } = await deploy();

      await agentic.transferOwnership(outsider.address);
      await expect(agentic.connect(outsider).acceptOwnership()).to.emit(
        agentic,
        'OwnershipTransferred',
      );

      expect(await agentic.owner()).to.equal(outsider.address);
      expect(await agentic.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it('lets nobody else accept', async () => {
      const { agentic, recipient, outsider } = await deploy();

      await agentic.transferOwnership(outsider.address);
      await expect(
        agentic.connect(recipient).acceptOwnership(),
      ).to.be.revertedWithCustomError(agentic, 'NotPendingOwner');
    });
  });
});
