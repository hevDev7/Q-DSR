import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { ErrorBoundary } from '@/components/error-boundary';
import { WalletProvider } from './lib/wallet';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import { useListAgents } from '@workspace/api-client-react';

import { AgentModal } from './components/agent-modal';
import { RegisterAgentModal } from './components/register-agent-modal';
import { Shell } from './components/shell';
import { SubmitEvidenceModal } from './components/submit-evidence-modal';
import { VerificationModal } from './components/verification-modal';
import { AgentsPage } from './pages/agents';
import { AuditPage } from './pages/audit';
import { GuidePage } from './pages/guide';
import { OverviewPage } from './pages/overview';
import { QueuePage } from './pages/queue';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Verdicts change only when someone submits evidence, and every mutation
      // invalidates explicitly, so background refetching would just add noise.
      refetchOnWindowFocus: false,
      staleTime: 2_000,
    },
  },
});

/**
 * Modal state lives here rather than in each page.
 *
 * Every entry point — the overview hero button, the queue, the registry, the
 * agent detail — opens the same three dialogs, and hoisting the state is what
 * makes "run verification" work identically from all of them. The original
 * mockup kept an `Agent | undefined` and rendered on `!== undefined`, which meant
 * the no-agent case could never open at all.
 */
function AppRoutes() {
  const [, navigate] = useLocation();
  const { data: agents = [] } = useListAgents();

  const [openAgentId, setOpenAgentId] = useState<string>();
  const [registering, setRegistering] = useState(false);
  const [submittingFor, setSubmittingFor] = useState<{ agentId?: string } | undefined>();
  const [activeRunId, setActiveRunId] = useState<string>();

  const openSubmit = (agentId?: string) => {
    setOpenAgentId(undefined);
    setSubmittingFor({ agentId });
  };

  return (
    <Shell>
      <Switch>
        <Route path="/queue">
          <QueuePage onOpenAgent={setOpenAgentId} onSubmit={() => openSubmit()} />
        </Route>
        <Route path="/agents">
          <AgentsPage onOpenAgent={setOpenAgentId} onRegister={() => setRegistering(true)} />
        </Route>
        <Route path="/audit" component={AuditPage} />
        <Route path="/guide" component={GuidePage} />
        <Route path="/">
          <OverviewPage
            onOpenAgent={setOpenAgentId}
            onRegister={() => setRegistering(true)}
            onSubmit={() => openSubmit()}
          />
        </Route>
        <Route>
          <div className="p-10 text-center text-[#829083]">
            Route not found.{' '}
            <button onClick={() => navigate('/')} className="text-[#c8f169] underline">
              Return to overview
            </button>
          </div>
        </Route>
      </Switch>

      {openAgentId && (
        <AgentModal
          agentId={openAgentId}
          onClose={() => setOpenAgentId(undefined)}
          onRun={(agentId) => openSubmit(agentId)}
        />
      )}

      {registering && (
        <RegisterAgentModal
          onClose={() => setRegistering(false)}
          onCreated={(agent) => {
            setRegistering(false);
            openSubmit(agent.id);
          }}
        />
      )}

      {submittingFor && (
        <SubmitEvidenceModal
          agent={agents.find((agent) => agent.id === submittingFor.agentId)}
          agents={agents}
          onClose={() => setSubmittingFor(undefined)}
          onStarted={(run) => {
            setSubmittingFor(undefined);
            setActiveRunId(run.id);
          }}
        />
      )}

      {activeRunId && (
        <VerificationModal
          runId={activeRunId}
          onClose={() => setActiveRunId(undefined)}
          onOpenAgent={(agentId) => {
            setActiveRunId(undefined);
            setOpenAgentId(agentId);
          }}
        />
      )}
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <RoutedErrorBoundary>
            <AppRoutes />
          </RoutedErrorBoundary>
        </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}
