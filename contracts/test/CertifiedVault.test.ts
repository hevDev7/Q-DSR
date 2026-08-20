import { expect } from 'chai';
import { ethers } from 'hardhat';

const EVIDENCE_ROOT = ethers.keccak256(ethers.toUtf8Bytes('evidence-root'));
const RESULT_DIGEST = ethers.keccak256(ethers.toUtf8Bytes('result-digest'));
const ENGINE = 'qdsr-core/1.0.0';

// [dsrBps, pboBps, trials, observations]
const CERTIFIED = [9_800n, 400n, 60n, 756n] as const;
const OVERFIT = [40n, 5_839n, 60n, 756n] as const;

async function deploy() {
  const [owner, alice, bob] = await ethers.getSigners();

  const registry = await (await ethers.getContractFactory('QDSRRegistry')).deploy(owner!.address);
  await registry.waitForDeployment();

  const vault = await (await ethers.getContractFactory('CertifiedVault')).deploy(
    await registry.getAddress(),
  );
  await vault.waitForDeployment();

  const good = ethers.keccak256(ethers.toUtf8Bytes('halcyon-drift'));
  const bad = ethers.keccak256(ethers.toUtf8Bytes('juniper-flow'));

  await registry.submitVerdict(good, EVIDENCE_ROOT, RESULT_DIGEST, ENGINE, ...CERTIFIED);
  await registry.submitVerdict(bad, EVIDENCE_ROOT, RESULT_DIGEST, ENGINE, ...OVERFIT);

  return { registry, vault, owner: owner!, alice: alice!, bob: bob!, good, bad };
}

const ONE = ethers.parseEther('1');

describe('CertifiedVault', () => {
  describe('the certification gate on capital', () => {
    it('accepts a deposit to a certified agent', async () => {
      const { vault, alice, good } = await deploy();
      await expect(vault.connect(alice).deposit(good, { value: ONE }))
        .to.emit(vault, 'Allocated')
        .withArgs(good, alice.address, ONE);
      expect(await vault.totalAllocated(good)).to.equal(ONE);
    });

    it('refuses a deposit to an agent the registry never certified', async () => {
      const { vault, alice, bad } = await deploy();
      await expect(
        vault.connect(alice).deposit(bad, { value: ONE }),
      ).to.be.revertedWithCustomError(vault, 'AgentNotCertified');
    });

    it('refuses a deposit to an agent with no verdict at all', async () => {
      const { vault, alice } = await deploy();
      const unknown = ethers.keccak256(ethers.toUtf8Bytes('nobody'));
      await expect(
        vault.connect(alice).deposit(unknown, { value: ONE }),
      ).to.be.revertedWithCustomError(vault, 'AgentNotCertified');
    });

    it('rejects an empty deposit', async () => {
      const { vault, alice, good } = await deploy();
      await expect(vault.connect(alice).deposit(good, { value: 0 })).to.be.revertedWithCustomError(
        vault,
        'NothingToDeposit',
      );
    });
  });

  describe('the gate tracks the latest verdict, live', () => {
    it('closes the moment an agent fails re-verification', async () => {
      const { registry, vault, alice, good } = await deploy();
      await vault.connect(alice).deposit(good, { value: ONE });

      // A later failing verdict is appended — the agent is no longer certified.
      await registry.submitVerdict(
        good,
        EVIDENCE_ROOT,
        ethers.keccak256(ethers.toUtf8Bytes('rerun')),
        ENGINE,
        ...OVERFIT,
      );

      const [open] = await vault.depositStatus(good);
      expect(open).to.equal(false);
      await expect(
        vault.connect(alice).deposit(good, { value: ONE }),
      ).to.be.revertedWithCustomError(vault, 'AgentNotCertified');
    });

    it('reopens if the agent is certified again', async () => {
      const { registry, vault, alice, good } = await deploy();
      await registry.submitVerdict(
        good,
        EVIDENCE_ROOT,
        ethers.keccak256(ethers.toUtf8Bytes('fail')),
        ENGINE,
        ...OVERFIT,
      );
      await registry.submitVerdict(
        good,
        EVIDENCE_ROOT,
        ethers.keccak256(ethers.toUtf8Bytes('pass-again')),
        ENGINE,
        ...CERTIFIED,
      );
      const [open] = await vault.depositStatus(good);
      expect(open).to.equal(true);
      await expect(vault.connect(alice).deposit(good, { value: ONE })).to.emit(vault, 'Allocated');
    });
  });

  describe('withdrawal is never gated — this is a trust primitive, not a trap', () => {
    it('lets a depositor withdraw even after the agent loses certification', async () => {
      const { registry, vault, alice, good } = await deploy();
      await vault.connect(alice).deposit(good, { value: ONE });

      await registry.submitVerdict(
        good,
        EVIDENCE_ROOT,
        ethers.keccak256(ethers.toUtf8Bytes('rerun')),
        ENGINE,
        ...OVERFIT,
      );

      // Deposits are now closed, but the depositor's own funds are still theirs.
      await expect(vault.connect(alice).withdraw(good, ONE))
        .to.emit(vault, 'Withdrawn')
        .withArgs(good, alice.address, ONE);
      expect(await vault.balanceOf(good, alice.address)).to.equal(0);
    });

    it('lets a depositor take part of their allocation', async () => {
      const { vault, alice, good } = await deploy();
      await vault.connect(alice).deposit(good, { value: ONE });
      await vault.connect(alice).withdraw(good, ethers.parseEther('0.4'));
      expect(await vault.balanceOf(good, alice.address)).to.equal(ethers.parseEther('0.6'));
    });

    it('stops a depositor from withdrawing more than they hold', async () => {
      const { vault, alice, good } = await deploy();
      await vault.connect(alice).deposit(good, { value: ONE });
      await expect(
        vault.connect(alice).withdraw(good, ethers.parseEther('1.5')),
      ).to.be.revertedWithCustomError(vault, 'InsufficientBalance');
    });

    it('keeps depositors’ balances separate', async () => {
      const { vault, alice, bob, good } = await deploy();
      await vault.connect(alice).deposit(good, { value: ONE });
      await vault.connect(bob).deposit(good, { value: ethers.parseEther('2') });

      // Bob cannot touch Alice's allocation.
      await expect(
        vault.connect(bob).withdraw(good, ethers.parseEther('2.5')),
      ).to.be.revertedWithCustomError(vault, 'InsufficientBalance');
      expect(await vault.totalAllocated(good)).to.equal(ethers.parseEther('3'));
    });
  });

  describe('shape', () => {
    it('rejects a zero registry address', async () => {
      const factory = await ethers.getContractFactory('CertifiedVault');
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        factory,
        'ZeroAddress',
      );
    });

    it('reports the metrics beside an open gate', async () => {
      const { vault, good } = await deploy();
      const [open, dsrBps, pboBps] = await vault.depositStatus(good);
      expect(open).to.equal(true);
      expect(dsrBps).to.equal(9_800n);
      expect(pboBps).to.equal(400n);
    });
  });
});
