import { describe, it, expect } from "vitest";
import {
  parsePolicy,
  resolveSelection,
  editPolicy,
  parseBundle,
} from "../src/selection.ts";
import { selectInventory, snapshot } from "../src/policy.ts";
import { policy, repo } from "./helpers.ts";
describe("repository scope", () => {
  it("excludes archives and explicit exclusions before detailed collection", () => {
    const rs = [repo(1), repo(2, { archived: true }), repo(3)];
    expect(
      resolveSelection(policy({ exclude: ["owner/repo-3"] }), rs).map((r) => [
        r.selected,
        r.reason,
      ]),
    ).toEqual([
      [true, "owner_discovery"],
      [false, "archived_default"],
      [false, "explicit_exclude"],
    ]);
  });
  it("exclusion beats explicit inclusion and archive override", () =>
    expect(
      resolveSelection(
        policy({
          include: ["owner/repo-1"],
          exclude: ["owner/repo-1"],
          overrides: { "owner/repo-1": { includeArchived: true } },
        }),
        [repo(1, { archived: true })],
      )[0].selected,
    ).toBe(false));
  it("archive inclusion is independent of fork filtering", () =>
    expect(
      resolveSelection(policy({ includeArchived: true, includeForks: false }), [
        repo(1, { archived: true, fork: true }),
      ])[0].reason,
    ).toBe("fork_filter"));
  it("supports specific archive opt-in and per-repo opt-out", () => {
    expect(
      resolveSelection(
        policy({ overrides: { "owner/repo-1": { includeArchived: true } } }),
        [repo(1, { archived: true })],
      )[0].selected,
    ).toBe(true);
    expect(
      resolveSelection(
        policy({
          includeArchived: true,
          overrides: { "owner/repo-1": { includeArchived: false } },
        }),
        [repo(1, { archived: true })],
      )[0].reason,
    ).toBe("archived_override");
  });
  it("selected mode and explicit empty scope never inherit owner discovery", () =>
    expect(resolveSelection(policy({ mode: "selected" }), [repo()])).toEqual(
      [],
    ));
  it("remove persists across discovery and clears obsolete override", () => {
    const p = editPolicy(
      policy({
        include: ["owner/repo-1"],
        overrides: { "owner/repo-1": { includeArchived: true } },
      }),
      "remove",
      "OWNER/REPO-1",
    );
    expect(resolveSelection(p, [repo()])[0].reason).toBe("explicit_exclude");
    expect(p.overrides).toEqual({});
  });
  it("add does not implicitly bypass archive filter", () =>
    expect(
      resolveSelection(editPolicy(policy(), "add", "owner/repo-1"), [
        repo(1, { archived: true }),
      ])[0].selected,
    ).toBe(false));
  it("normalizes case but rejects duplicate identities and unknown overrides", () => {
    expect(parsePolicy(policy({ owners: ["OWNER"] })).owners).toEqual([
      "owner",
    ]);
    expect(() =>
      parsePolicy(policy({ include: ["owner/repo-1", "OWNER/REPO-1"] })),
    ).toThrow("duplicate_selection_identity");
    expect(() =>
      resolveSelection(
        policy({ overrides: { "owner/missing": { includeArchived: true } } }),
        [repo()],
      ),
    ).toThrow("override_not_candidate");
  });
  it("rejects duplicate JSON keys, invalid types and unknown fields", () => {
    expect(() => parsePolicy('{"mode":"discover","mode":"selected"}')).toThrow(
      "duplicate_json_key",
    );
    expect(() =>
      parsePolicy({ ...policy(), includeArchived: "false" }),
    ).toThrow();
    expect(() => parsePolicy({ ...policy(), send: true })).toThrow();
  });
  it("exclusion follows stable ID on rename, but owner transfers do not expand scope", () => {
    const previous = resolveSelection(policy({ exclude: ["owner/repo-1"] }), [
      repo(),
    ]);
    expect(
      resolveSelection(
        policy({ exclude: ["owner/repo-1"] }),
        [repo(1, { full_name: "owner/new-name" })],
        previous,
      )[0].reason,
    ).toBe("explicit_exclude");
    expect(
      resolveSelection(
        policy(),
        [repo(1, { full_name: "other/repo", owner: { login: "other" } })],
        previous,
      ),
    ).toEqual([]);
  });
  it("private access loss is different from an empty accessible private repository", async () => {
    const p = await snapshot(
      { selection: policy(), repos: {}, dispositions: [] },
      "local",
    );
    const expected = [repo(1, { private: true })];
    const installations = [
      {
        id: 1,
        account: { login: "owner" },
        repository_selection: "all" as const,
        permissions: { contents: "read" },
        suspended_at: null,
      },
    ];
    const missing = selectInventory(
      p,
      { repos: [], installations, gaps: [] },
      expected,
    );
    expect(missing.gaps[0].code).toBe("expected_private_repo_missing");
    expect(missing.selection[0].reason).toBe("not_accessible");
    const empty = selectInventory(
      p,
      { repos: expected, installations, gaps: [] },
      expected,
    );
    expect(empty.gaps).toEqual([]);
    expect(empty.selection[0].selected).toBe(true);
  });
  it("does not flag excluded private repositories as an access requirement", async () => {
    const p = await snapshot(
      {
        selection: policy({ exclude: ["owner/repo-1"] }),
        repos: {},
        dispositions: [],
      },
      "local",
    );
    expect(
      selectInventory(
        p,
        {
          repos: [],
          installations: [
            {
              id: 1,
              account: { login: "owner" },
              repository_selection: "all",
              permissions: {},
              suspended_at: null,
            },
          ],
          gaps: [],
        },
        [repo(1, { private: true })],
      ).gaps,
    ).toEqual([]);
  });
  it("restricted discovery cannot claim full private coverage", async () => {
    const p = await snapshot(
      { selection: policy(), repos: {}, dispositions: [] },
      "local",
    );
    expect(
      selectInventory(
        p,
        {
          repos: [repo()],
          installations: [
            {
              id: 1,
              account: { login: "owner" },
              repository_selection: "selected",
              permissions: {},
              suspended_at: null,
            },
          ],
          gaps: [],
        },
        [],
      ).gaps[0].code,
    ).toBe("discovery_installation_restricted");
  });
  it("rejects unsupported context and path traversal", () =>
    expect(() =>
      parseBundle({
        selection: policy(),
        repos: { "owner/repo-1": { docs: ["../secret"] } },
        dispositions: [],
      }),
    ).toThrow("invalid_context_path"));
});
