import { ArrowUpRight, Terminal } from 'lucide-react';

import { useGetChainConfig } from '@workspace/api-client-react';

import { PageIntro, Panel } from '../components/primitives';
import { shortHash } from '../lib/format';

const SECTIONS = [
  {
    no: '01',
    title: 'Bring the whole search space',
    text: 'returns.csv is the strategy you are submitting. trials.csv is every configuration you tried to get there. Without the second file the Probability of Backtest Overfitting is not merely inaccurate — it is undefined, and the submission is refused.',
  },
  {
    no: '02',
    title: 'Survive two independent tests',
    text: 'CSCV splits the track record into 16 blocks and evaluates all 12,870 symmetric halves, asking how often your in-sample winner lands below the out-of-sample median. The Deflated Sharpe Ratio then discounts your Sharpe by the number of trials you ran and by the skew and fat tails of your returns.',
  },
  {
    no: '03',
    title: 'Publish evidence, not claims',
    text: 'The bundle, the bootstrap distribution and the CSCV logits are written to 0G Storage under a merkle root. The root, the metrics and a SHA-256 digest of the result go on 0G Chain. The certification rule itself lives in the contract, so no attestor can certify an agent that fails the published bar.',
  },
  {
    no: '04',
    title: 'Let strangers check the work',
    text: 'Anyone can pull the evidence back out of storage, re-run the pinned engine with the recorded seed, and compare digests. That is what makes the badge mean something: not that we vouched for it, but that disagreeing with us is cheap and public.',
  },
];

export function GuidePage() {
  const { data: chain } = useGetChainConfig();

  return (
    <div className="animate-rise">
      <PageIntro
        eyebrow="Reference implementation"
        title="Protocol guide"
        description="The working agreement between researchers, reviewers, and the chain. Read this before submitting a strategy for certification."
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Panel className="overflow-hidden">
          <div className="grid divide-y divide-[#222b2c] md:grid-cols-2 md:divide-x md:divide-y-0">
            {SECTIONS.map((section) => (
              <div key={section.no} className="group p-6 hover:bg-[#141d1f]">
                <div className="mb-8 flex items-start justify-between">
                  <span className="font-mono text-[11px] text-[#a6c960]">{section.no}</span>
                  <ArrowUpRight
                    size={15}
                    className="text-[#4d5d51] transition-transform group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-[#c8f169]"
                  />
                </div>
                <h2 className="text-[15px] font-bold text-[#e2ebdf]">{section.title}</h2>
                <p className="mt-3 text-[11px] leading-6 text-[#77857a]">{section.text}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-[#222b2c] bg-[#111a17] p-6">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-[#a7c866]">
              <Terminal size={14} />
              Minimum evidence contract
            </div>
            <div className="overflow-x-auto rounded-lg border border-[#2b3831] bg-[#0c1311] p-4 font-mono text-[10px] leading-6 text-[#8fa38d]">
              <span className="text-[#91bd59]">evidence/</span>
              <br />
              <span className="text-[#c8f169]">├──</span> returns.csv{' '}
              <span className="text-[#546758]"># timestamp,return — the submitted strategy</span>
              <br />
              <span className="text-[#c8f169]">└──</span> trials.csv{' '}
              <span className="text-[#546758]"># T × N — every configuration explored</span>
            </div>
            <p className="mt-3 text-[10px] leading-6 text-[#69786e]">
              The submitted series must appear as one of the columns in trials.csv. A polished series
              that was never part of the declared search space makes selection bias invisible, so the
              engine refuses it.
            </p>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-5">
            <h3 className="mb-3 text-[12px] font-bold text-[#dce7d6]">Passing thresholds</h3>
            <dl className="space-y-3 font-mono text-[10px]">
              {[
                ['Deflated Sharpe Ratio', '≥ 0.95'],
                ['Probability of Backtest Overfitting', '≤ 0.10'],
                ['Observations (T)', '≥ 252'],
                ['Declared trials (N)', '≥ 2'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-[#1e2726] pb-2">
                  <dt className="text-[#77857a]">{label}</dt>
                  <dd className="shrink-0 text-[#c8f169]">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[10px] leading-6 text-[#69786e]">
              These four constants are compiled into the registry contract. The attestor reports
              measurements; the chain applies the rule. The attestor is a server key and is
              never the wallet you connect — it can record a measurement, it cannot decide a
              verdict.
            </p>
          </Panel>

          <Panel className="p-5">
            <h3 className="mb-2 text-[12px] font-bold text-[#dce7d6]">Why DSR is a probability</h3>
            <p className="text-[11px] leading-6 text-[#77857a]">
              The Deflated Sharpe Ratio answers a yes-or-no question with a number between 0 and 1:
              given that this strategy was picked as the best of N attempts, and given how skewed and
              fat-tailed its returns are, what is the chance its true Sharpe ratio is above zero? A
              DSR of 0.9842 is strong. A DSR of 3.61 is a category error.
            </p>
          </Panel>

          <Panel className="p-5">
            <h3 className="mb-3 text-[12px] font-bold text-[#dce7d6]">This deployment</h3>
            <dl className="space-y-2 font-mono text-[10px] leading-6">
              {[
                ['engine', chain?.engineVersion ?? '—'],
                ['network', chain?.configured ? chain.networkName : 'not connected'],
                ['evidence storage', chain?.storageMode ?? '—'],
                ['attestor', shortHash(chain?.attestorAddress, 10, 6)],
                ['registry', shortHash(chain?.registryAddress, 10, 6)],
                ['agentic id', shortHash(chain?.agenticIdAddress, 10, 6)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-[#77857a]">{label}</dt>
                  <dd className="text-[#dce7d6]">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
