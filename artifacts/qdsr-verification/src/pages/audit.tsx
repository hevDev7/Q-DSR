import { useState } from 'react';
import { Activity, Check, CircleAlert, ExternalLink, Search } from 'lucide-react';

import { useGetChainConfig, useListAuditEvents } from '@workspace/api-client-react';

import { EmptyState, PageIntro, Panel, SearchBar } from '../components/primitives';
import { clockTime, relativeTime, shortHash } from '../lib/format';

const TONE_RING: Record<string, string> = {
  good: 'border-[#64883b]/50 bg-[#26351d] text-[#c8f169]',
  bad: 'border-[#8e4844]/50 bg-[#34201f] text-[#ed7770]',
  warn: 'border-[#946b37]/50 bg-[#372b1c] text-[#f3b761]',
  cyan: 'border-[#367e7d]/50 bg-[#193130] text-[#81e6e0]',
  neutral: 'border-[#354146] bg-[#202b2f] text-[#9aaea8]',
};

export function AuditPage() {
  const [search, setSearch] = useState('');
  const { data: events = [] } = useListAuditEvents({ limit: 200, search: search || undefined });
  const { data: chain } = useGetChainConfig();

  return (
    <div className="animate-rise">
      <PageIntro
        eyebrow="Verification ledger"
        title="Audit trail"
        description="A reviewable timeline of every material action taken by operators and the verification engine."
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Panel>
          <div className="flex flex-col gap-3 border-b border-[#222b2c] p-4 sm:flex-row">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Filter by actor, event, or detail…"
              icon={<Search size={15} />}
            />
          </div>

          {events.length === 0 ? (
            <EmptyState
              testId="empty-audit"
              icon={<Activity size={20} />}
              title="Nothing recorded yet"
              body="The ledger fills as agents are registered, verified, and anchored."
            />
          ) : (
            <div className="divide-y divide-[#202a2b]">
              {events.map((event, index) => (
                <div
                  key={event.id}
                  data-testid={`audit-event-${index}`}
                  className="flex gap-4 px-5 py-5 hover:bg-[#141d1f]"
                >
                  <div
                    className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${TONE_RING[event.tone] ?? TONE_RING.neutral}`}
                  >
                    {event.tone === 'good' ? (
                      <Check size={14} />
                    ) : event.tone === 'bad' ? (
                      <CircleAlert size={14} />
                    ) : (
                      <Activity size={14} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-[#dce7d6]">
                        {event.action}
                      </span>
                      <span className="font-mono text-[9px] text-[#68766c]">by {event.actor}</span>
                    </div>
                    <div className="mt-1 break-words text-[11px] leading-6 text-[#7e8c81]">
                      {event.detail}
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-[9px] text-[#5c6a61]">
                    <div>{clockTime(event.createdAt)}</div>
                    <div className="mt-1">{relativeTime(event.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel className="p-5">
            <h3 className="mb-3 text-[12px] font-bold text-[#dce7d6]">Chain anchoring</h3>
            <dl className="space-y-2 font-mono text-[10px] leading-6">
              {[
                ['network', chain?.configured ? chain.networkName : 'not connected'],
                ['chain id', chain?.chainId ? String(chain.chainId) : '—'],
                ['registry', shortHash(chain?.registryAddress, 10, 6)],
                ['agentic id', shortHash(chain?.agenticIdAddress, 10, 6)],
                ['attestor', shortHash(chain?.attestorAddress, 10, 6)],
                ['storage mode', chain?.storageMode ?? '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-[#77857a]">{label}</dt>
                  <dd className="text-[#dce7d6]">{value}</dd>
                </div>
              ))}
            </dl>
            {chain?.explorerBaseUrl && chain.registryAddress && (
              <a
                href={`${chain.explorerBaseUrl}/address/${chain.registryAddress}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-center gap-1.5 font-mono text-[10px] text-[#a4c85e] hover:text-[#d5f27b]"
              >
                open registry on 0G explorer <ExternalLink size={11} />
              </a>
            )}
          </Panel>

          <Panel className="p-5">
            <h3 className="mb-2 text-[12px] font-bold text-[#dce7d6]">What integrity means here</h3>
            <p className="text-[11px] leading-6 text-[#77857a]">
              Nothing in this ledger is trusted because we wrote it. Each anchored verdict carries a
              0G Storage root and a result digest, and anyone can pull the evidence back down, re-run
              the pinned engine, and check that the numbers reproduce.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
