export type Policy = {
  schemaVersion: 1;
  mode: "discover" | "selected";
  owners: string[];
  include: string[];
  exclude: string[];
  includeArchived: boolean;
  includeForks: boolean;
  overrides: Record<
    string,
    { includeArchived?: boolean; includeForks?: boolean }
  >;
};
export type Repo = {
  id: number;
  full_name: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  owner: { login: string };
  html_url: string;
  has_issues: boolean;
  size: number;
};
export type Selection = {
  repository: string;
  repositoryId?: number;
  selected: boolean;
  reason: string;
  private?: boolean;
  archived?: boolean;
  fork?: boolean;
  repo?: Repo;
};
export type Gap = { repository?: string; area: string; code: string };
export type Evidence = {
  url: string;
  label: string;
  sha?: string;
  at?: string;
};
export type State =
  | "active_failure"
  | "review_candidate"
  | "acceptance_gap"
  | "resolved"
  | "deferred"
  | "unknown";
export type Finding = {
  id: string;
  repositoryId: number;
  repository: string;
  kind: string;
  scope: string;
  state: State;
  priority: "act" | "review" | "watch";
  confidence: "observed" | "needs_review";
  observedAt: string;
  headSha: string | null;
  title: string;
  evidence: Evidence[];
  recommendation: string;
  validationGap: string | null;
  dispositionRef: string | null;
  signature: string;
  changed: boolean;
  firstSeen?: string;
};
export type Context = {
  docs?: string[];
  expectations?: {
    workflow: string;
    event: string;
    branch?: string;
    maxAgeHours: number;
  }[];
  artifacts?: {
    workflow: string;
    adapter: "podcast" | "scheduled-health";
    namePrefix: string;
    maxAgeHours: number;
    entry?: string;
  }[];
};
export type Disposition = {
  findingId: string;
  signature: string;
  state: "deferred" | "resolved";
  reference: { repository: string; path: string; sha256: string };
  url: string;
  reason: string;
  revisitAt: string;
};
export type Bundle = {
  selection: Policy;
  repos: Record<string, Context>;
  dispositions: Disposition[];
};
export type PolicySnapshot = { version: string; hash: string; bundle: Bundle };
export type Installation = {
  id: number;
  account: { login: string };
  repository_selection: "all" | "selected";
  permissions: Record<string, string>;
  suspended_at: string | null;
};
export type Inventory = {
  repos: Repo[];
  installations: Installation[];
  gaps: Gap[];
};
export type Collected = {
  repo: Repo;
  headSha: string | null;
  observedAt: string;
  branches: string[];
  workflows: any[];
  runs: any[];
  jobs: Record<string, any[]>;
  prs: any[];
  issues: any[];
  docs: {
    path: string;
    sha: string;
    hash: string;
    url: string;
    text: string;
  }[];
  artifacts: any[];
  gaps: Gap[];
  requests: number;
};
export type Report = {
  schemaVersion: 1;
  id: string;
  observedAt: string;
  completedAt: string;
  policy: PolicySnapshot;
  selection: Selection[];
  coverage: {
    status: "complete" | "partial" | "failed" | "empty";
    selected: number;
    scanned: number;
    privateSelected: number;
    privateScanned: number;
    gaps: Gap[];
  };
  findings: Finding[];
  // Delivery receipts at render time; full findings remain in the private JSON.
  reportedActions?: string[];
  repositories: Collected[];
  changes: { added: string[]; removed: string[] };
  limitations: string[];
};
export type ScanParams = {
  id: string;
  scheduledAt: string;
  send: boolean;
  deliverAt?: string;
};
export type RuntimeEnv = Omit<
  Env,
  "POLICY_SOURCE" | "SCHEDULE_ENABLED" | "SEND_ENABLED" | "FIRST_WEEKLY_SLOT"
> & {
  POLICY_SOURCE: string;
  SCHEDULE_ENABLED: string;
  SEND_ENABLED: string;
  FIRST_WEEKLY_SLOT: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  ADMIN_TOKEN: string;
  DIGEST_TO_EMAIL: string;
  DIGEST_FROM_EMAIL: string;
  DIGEST_FROM_NAME: string;
  EMAIL_EVENT_ACCOUNT_ID: string;
  EMAIL_EVENT_SUBSCRIPTION_ID: string;
  EMAIL_EVENT_DOMAIN: string;
};
