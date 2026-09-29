# Pelagion takeover TODO — CodeGraph

Prepared 2026-09-26. Maintained execution plan; planning complete only after the
review checklist below closes. Product implementation is not authorized by this file.
Working repository: `C:/Users/hemamialagha/Documents/SD/resources/codegraph`.
Integration repository: `C:/Users/hemamialagha/Documents/SD/pelagion-assistant`.
Product role: maintained CodeGraph engine behind Pelagion Code-context Assistant.

## Purpose, assessment and recommendation

Adopt the existing TypeScript/Node engine as the automatic local code-context
preparation foundation. Keep useful extraction, SQLite/FTS, graph traversal, CLI,
WASM/native backends and tests. Maintain a small fork patch series and a Python
process wrapper. First deliver search candidates and independently verified source;
admit relationship and impact claims only after consistent generation and supported
Python semantics pass. This is a fork-plus-wrapper adoption, not a rewrite in Python.

The separate [takeover proposal](../codegraph-evaluation/TAKEOVER-PROPOSAL.md) remains
historical rationale and extension direction. This TODO is its current executable
backlog, while WF-CI-01 owns combined product acceptance. Proposal phases 0–7 map
to phases 1–10 below; its phase 8 remains explicitly deferred. Original CG-01–05 IDs
are preserved separately. Do not restart the already repaired defects or count them
as a finished release. Extra languages/frameworks, runtime tracing, remote service,
new embeddings, viewer enhancement and automatic Git mutations are later assignments.

## Source identity and inspected evidence

| Item | Observed record, 2026-09-26 |
| --- | --- |
| Upstream | [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) |
| Fork / sole configured remote | [HiradEmami/codegraph](https://github.com/HiradEmami/codegraph), `origin` for fetch/push; no upstream remote was added |
| Base | `main`, `ba3c21e50d9129d2f5f3843ec3728868ae6d47a1`; live fork HEAD matched; GitHub upstream comparison reported identical |
| Current branch | `feat/pelagion-takeover`, created from that local main; commit unchanged |
| Displayed package version | `@colbymchenry/codegraph` 1.6.0; not proof of installed/fork provenance |
| Published release | [v1.6.0](https://github.com/colbymchenry/codegraph/releases/tag/v1.6.0), 2026-08-26; current base is a later main commit, not assumed tag-equivalent |
| Existing local work | 11 modified tracked files and 10 untracked repair files preserved; 1,109 nonignored files hash-checked across branch creation |
| Archive comparison | No supplied CodeGraph archive identified; none compared |
| Source authenticity limits | Commit exists in upstream and fork; GitHub reports this commit unsigned. No local cryptographic signing verification or released artifact acceptance occurred |
| Maintenance evidence | Upstream not archived at inspection; latest reported push 2026-09-23. Public repository advisory endpoint returned no entries; this is not a dependency/security clearance |

The source and all dependency lock hashes are in the [branch manifest](../../pelagion-assistant/reports/supervisor-takeovers/branch-setup.json).
The live [comparison](https://github.com/colbymchenry/codegraph/compare/ba3c21e50d9129d2f5f3843ec3728868ae6d47a1...main)
and [public advisories](https://github.com/colbymchenry/codegraph/security/advisories)
are dated observations in the primary-source receipt, not permanent promises about main.
No deployable commit includes the uncommitted repairs yet. Phase 5 must produce an
explicitly authorized immutable fork artifact; installing the same-version registry
package would omit our changes.

Read evidence includes [AGENTS](AGENTS.md), [README](README.md),
[package/commands](package.json), [lock](package-lock.json),
[public facade](src/index.ts), [extractor](src/extraction/index.ts),
[Python bindings](src/resolution/python-bindings.ts),
[module mappings](src/resolution/python-modules.ts), [MCP routing](src/mcp/tools.ts),
[dedup](src/mcp/explore-dedup.ts), [budget adapter](src/mcp/explore-token-budget.ts),
[token counter](src/context/token-budget.ts), [test workspace](vitest.workspace.mts),
[release workflow](.github/workflows/release.yml) and [bundle script](scripts/build-bundle.sh).

Representative path: CLI/MCP calls `CodeGraph`; extraction records AST nodes/import
evidence; resolution writes edges; explore selects source and relationship prose;
the local token-budget adapter packages that rendering. Python must eventually
consume typed service evidence rather than reverse-parse human Markdown.

**Recorded acceptance:** [repair report](../codegraph-evaluation/REPAIR-REPORT.md) and
[integration receipt](../codegraph-evaluation/repair-evidence/supervisor-integration.json)
retain 183 focused tests across 11 files (70 resolver, 113 budget), TypeScript/assets
checks and a fresh copy of the original 252-Python-file corpus. Those reports identify
21 current repair files; they are historical evidence, not a test run during planning.
The prior broader exploratory run had failures/resource limits; do not label those
pre-existing until an unmodified control reproduces them.

Retained repairs, each complete only within that report's support and validation scope:

- [x] CG-01 PDF imports/constructors use their actual module and scope.
- [x] CG-02 Video's imported alias is preserved ahead of unrelated name matches.
- [x] CG-03 Relative, absolute and mapped alias fixtures have general regression coverage.
- [x] CG-04 Supported static setuptools package-directory mappings are interpreted without executing project code.
- [x] CG-05 Opt-in o200k_base/cl100k_base serialized-success-packet budgets and deduplication are implemented.

These five repairs do not prove a coherent graph/source generation, target-model
tokenizer mapping, full-process resource bounds or end-to-end Codex savings.

## Runtime, packaging and licensing assessment

`package.json` declares Node >=20 and <25, but `src/db/sqlite-adapter.ts` uses
`node:sqlite`; source operation needs at least the actually supported SQLite-bearing
runtime (project guidance says >=22.5). The local runtime is Node 24.12.0; the inspected
bundle script defaults to 24.16.0. Phase 1 selects one exact supported runtime and
tests it; do not treat the broad engines field or test guard override as qualification.
TypeScript, Vitest and the Svelte/jsdom project are build/test dependencies. Optional
Rust/N-API extraction brings a separate Cargo lock/toolchain and per-platform binary.
WASM grammars, SQL schema and viewer assets must be present in the chosen package.
The local repair adds pinned js-tiktoken 1.0.21 (base64-js 1.5.1 transitively).

No hosted model is required for ordinary indexing. Use `DO_NOT_TRACK=1` and explicit
`CODEGRAPH_TELEMETRY=0` / `CODEGRAPH_NO_UPDATE_CHECK=1` in managed launches and verify
inheritance by descendants: telemetry and the GitHub release update checker are
separate network paths (`src/upgrade/update-check.ts`). Test no unexpected network
activity. The ordinary installer
edits agent configuration; the release workflow can commit/push changelog and version
changes and publish artifacts. Neither is a baseline setup command for this task.

The [root license](LICENSE) is MIT. [MIT terms](https://opensource.org/license/mit)
permit commercial modification/distribution subject to required notices. Phase 1/5
must inventory the actual Node runtime, SQLite, npm/Cargo dependencies, tokenizer
data, WASM grammar licenses and any viewer assets. Root MIT alone does not clear the
bundle or branding. Preserve upstream attribution; a release namespace/name and
distribution notices need an explicit decision before publication.

## Evidence-linked capability matrix

| Required capability | Existing evidence | Decision / layer | Dependency and validation | Current limitation |
| --- | --- | --- | --- | --- |
| AST extraction and search | `src/extraction/`, `src/db/`, `src/search/`; retained corpus run | Reuse core | Unmodified baseline; exact parser/backend corpus | Parsing coverage is not relationship accuracy |
| Correct Python bindings/mappings | Named repair files/tests and CG-01–04 | Preserve patches, extend demonstrated gaps in core | Alias/collision/scope/layout held-out oracle; native/WASM comparison | Static subset; dynamic setup/import/value flow unsupported |
| Coherent generations | File/config hashes, writer lock, sync exist in `src/index.ts` | Patch core receipts/publication; wrap delivery | Source/config/resolver manifests, interrupted-refresh oracle | `sync` lock failure returns zero counters; current packet lacks typed common generation |
| Verified source | Explore rereads files and has drift guards in `src/mcp/tools.ts` | Wrap independent byte/range verification | Same-size/mtime mutation and text-decoding cases | SHA1 prefix in dedup is not processed-byte provenance; metadata fast path/cache is narrower |
| Structured protocol | Public class, CLI and MCP already exist | Refactor shared core services narrowly; build Python adaptor | Version/capability/partial/error contract fixtures | Current budget conversion consumes rendered explore text |
| Token budgets | CG-05 exact supported encodings | Reuse core counter; build final packet in code-context | Entire serialized packet, Unicode, omissions, small budget | Transport/error/host/billing outside recorded cap |
| Cross-provider delivery ledger | No accepted Pelagion implementation | Build once in code-context, consume from both providers | Acknowledged base, delivered-only dedup, context-loss refresh | Upstream MCP connection identity is insufficient |
| Relationships/impact/contracts/check suggestions | Resolver/traversal and inferred edges | Reuse/patch core; Pelagion policy mapping | Supported-subset precision/recall, explicit uncertainty | Not exhaustive runtime impact; mandatory tests cannot be removed |
| Bounded lifecycle | Workers, locks, watchers and existing limits | Configure/patch core + process wrapper | Deadline, cancellation, orphan/crash/EOF/lock cases | No assumed hard total-memory cap or atomic source capture |
| Installed Python API/CLI | Planned `code-context-assistant`, no package yet | Build Pelagion integration | Optional backend absence, installed-outside-checkout conformance | Development checkout is not a deployable artifact |

## Future upstream baseline procedure

Phase 2 runs against an isolated clean copy of the exact base commit above, with its
own original `package-lock.json`; retain a separate patched copy using our lock. Never
reset this dirty checkout to create the control. Record exact Node/npm, OS, lock and
installed package inventory. Temporary build/test directories and user-home/config
paths belong only to that baseline. Suppress telemetry AND background update checks
with the managed environment above, and omit model credentials; no
agent installer, global configuration edits or paid agent evaluation.

Verified repository entry points: `npm ci` installs from the lock and can run lifecycle
scripts; inspect them and pre-authorize dependency downloads in the baseline task.
`npm run build` compiles, copies SQL/WASM and builds the viewer. `npm test` runs both
Vitest projects. `npm run eval` builds then may invoke npx to locate tsx; inventory and
pin that runner before use, never permit an implicit latest download. Focused repair
replays use the installed local Vitest executable with the named retained test files.
An initial `--ignore-scripts` materialization plus explicitly reviewed build steps may
be used as a documented controlled variant; it is not silently called upstream setup.

Tests use real SQLite/temp files and spawn CLI/MCP descendants; Windows cleanup may
fail on open handles. Isolate and capture each owned process tree, fixed deadlines,
before/after file manifests and logs under a fresh `codegraph-evaluation/baseline/<id>/`.
Upstream notes about Windows failures are hypotheses until reproduced on the exact
control. No broad cleanup by directory prefix, no user process termination. Remove
only verified run-owned resources after retaining evidence. Native Rust build/download
and UI-package release qualification are separate matrix legs, not assumed from a
TypeScript compile. No baseline command has been run by this planning assignment.

## Program, ownership and shared prerequisites

These component phases implement the existing [WF-CI-01 specification](../../pelagion-assistant/docs/workflows/phase-01-langgraph-codegraph.md);
they do not authorize implementation merely by existing. The parent specification's
section 23 is the canonical cross-plan dependency and gate table. Its WP-00–08 and
A01–12 remain the program's acceptance boundary. The other component plans are
[CodeGraph](../codegraph/TAKEOVER-TODO.md), [secondary MCP](../codebase-memory-mcp/TAKEOVER-TODO.md)
and [LangGraph](../langgraph/TAKEOVER-TODO.md). A shared gate is counted once by its
canonical owner; consumer conformance tasks below are different deliverables.

Phase 1 starts with this reviewed plan and a supervisor assignment naming the
adoption-record writer and provisional scope. It produces the source/profile inputs
to X-01; accepted X-01 is not its own prerequisite. The supervisor consolidates
those inputs with the Architect and closes X-01 before dependent contract/runtime
work. This separates permission to investigate adoption from capability acceptance.

CodeGraph supplies automatic preparation candidates. The secondary provider is
queried only for a specific evidence gap, including changed source; it is not a
mandatory second search. Ordinary current-source recovery remains available.
LangGraph runs the execution graph behind Pelagion's private adapter. None of the
three chooses task authorization or replaces independent acceptance checks.

| Layer / accountable role | Concrete ownership and rule |
| --- | --- |
| Fork maintainer | This repository's core, focused fixes, upstream tests, build/patch inventory and component documentation; one named writer per assignment |
| Code-context owner | Planned `src/tools/code-context-assistant/`, its central `docs/code-context-assistant/`, `tests/code-context-assistant/`, and internal/external `tools/code_context_assistant/` schema directories in Pelagion; both providers share this owner and evidence/budget ledger |
| Workflow core owner | Planned `src/workflows/core/`, core workflow schemas and central workflow docs/tests; private LangGraph compiler/runner, checkpoint and operation lifecycle |
| Developer preset owner | Planned `src/workflows/presets/developer/`, developer workflow schemas/docs/tests; original request, instruction scope, immutable check plan, Codex attempt and bounded repair loop |
| Supervisor | Pelagion root registration, dependency union/lock/environment, shared bases/utilities/adaptors, type mirrors, cross-plan interfaces and final integration |
| Evaluator | One retained labelled corpus, held-out task study and independent accepted-outcome review; no repeated paid study per fork |
| Architect / adviser / manager | Architecture and capability admission / adoption value and risk / dependencies, evidence and progress; reviews do not grant feature authorization |

The [root engineering standard](../../pelagion-assistant/SKILL.md), [ownership](../../pelagion-assistant/docs/standards/ownership.md),
[schemas](../../pelagion-assistant/docs/standards/schemas.md) and [errors](../../pelagion-assistant/docs/standards/errors.md)
apply to new Pelagion code. Keep its single Python distribution, root `pyproject.toml`,
`uv.lock` and prepared `.venv`. These upstream repositories retain their own build
systems; isolated future upstream test environments are temporary evaluation
infrastructure, not extra Pelagion tool projects. Only the supervisor installs a
selected dependency union. External models are strict Pydantic v2 contracts, with
IO-free validation, backend-neutral values, bounded immutable collections and lazy
optional backends. API processing has one implementation; CLI entry points are thin.

Reuse delivered [bounded IO](../../pelagion-assistant/docs/shared-library/io.md),
[path validation](../../pelagion-assistant/docs/shared-library/paths.md) and
[discovery/output reservation](../../pelagion-assistant/docs/shared-library/path-discovery.md) within
their actual guarantees. `resolve_path` is not containment; simple `write_json` is
not atomic publication; sequential capture is not a simultaneous filesystem snapshot.
Use verified processing bytes and preserve existing outputs on failure.

**Unprovided services are explicit prerequisites.** Shared Phase 9 manifest/cache/
workspace/lease services remain unimplemented. Their owner is the supervisor; a
consumer must request the exact contract, resource lifecycle and acceptance before
using them. Do not implement excluded generic command runners, capability probes,
evidence deduplicators or source mappers as shared helpers. Code-context owns its
domain evidence ledger; workflow checkpoints and engine indexes remain specialized
stores. [Git Phase 11](../../pelagion-assistant/docs/git-assistant/phase11-prerequisites.md) permits only
its own bounded retained captures and provides no generic shared lifecycle service.
Resolve Git Phase 12/16 versus code-context search/context ownership through public
contracts before overlapping implementation; private fixture helpers are not services.

Initial qualification targets local Windows x64, Python 3.12 and the declared 3.13
compatibility boundary. Broader upstream platform claims are preserved as upstream
claims. Linux/macOS/ARM product support requires its own actual execution evidence.
The supervisor and maintainer must settle numerical source/output/CPU/memory/disk/
deadline limits and hard-versus-observed enforcement before the relevant operation
is admitted. A timeout of a Python future is not proof its worker has stopped.

## Validation, maintenance and accounting rules

Use focused tests during assigned implementation. The separately assigned upstream
baseline may run its declared broad upstream suite in isolation; final whole-tool
integration, coverage, documentation builds and clean installation occur at release
acceptance. Never lower thresholds, hide failures or call mocked behavior real backend
acceptance. Preserve logs, exit codes, durations, counts, skipped/xfail reasons and
failed runs alongside corrective reruns. A documented CI matrix is not a local pass.

All public operations need valid/invalid contract and JSON/Python round-trip checks,
API/CLI consistency, unavailable optional backend behavior, source identity, bounded
output, safe errors, cancellation/descendant cleanup and output-preservation evidence
where applicable. Protocol, stored-data and public-contract versions are separate.
Changing a build, parser, configuration, policy or tokenizer invalidates its relevant
capability/cache evidence. Restore requires an acknowledged compatible receiver or a
self-contained refresh; engine connection lifetime is not conversation lifetime.

**Artifact refresh is a phase completion requirement.** After initial pinning, every
later engine/protocol/parser/dependency change must produce a new immutable source
pin and artifact manifest, pass focused component and installed-consumer conformance,
and replace the consumed artifact in a supervisor-owned window. Retain the previous
compatible artifact/store for rollback and invalidate affected acceptance/cache
receipts. A phase changing fork source cannot complete with the old installed binary.
Integration studies and final release identify the actual consumed artifact, not just
the reviewed source tree. Publication/commit authority must be obtained before the
new pin is represented as remotely available; local manifests remain distinct.

Private qualification can use a supervisor-approved immutable local source archive
and artifact, identified by full SHA-256 manifests, upstream base and patch inventory.
This option does not require a push or a registry release. A later remotely consumed
dependency must separately prove that its exact fork commit is available remotely.
Never describe an uncommitted working tree as a commit pin or a local receipt as a
published release. Local qualification, distribution clearance and publication are
separate decisions; upstream notices remain intact under Pelagion's own license.

The maintainer reviews upstream changes and direct/transitive advisories before every
upgrade/release and at least monthly while supported. Urgent relevant advisories get
immediate triage. Keep patches small with problem, affected files, upstream base,
failing/passing regression, maintenance owner and upstream disposition. Contributing
upstream, signing a DCO, publishing, tagging or pushing requires an explicit assignment.
Do not claim to represent upstream maintainers. No automatic upstream merge or global
agent installation. Rollback retains the prior accepted artifact and its compatible
store; migrate explicitly or rebuild only owned derived data. Never delete user source,
silently downgrade a database or retry an external effect with unknown completion.

Performance evidence records source/fixture/toolchain/lock/artifact hashes, machine,
cold startup, indexing, warm requests, all workers' memory/CPU/disk, failures, output
bytes and declared encoding tokens. Only the shared WF-CI-01 study may establish
end-to-end benefit: at least 20 representative tasks, repeated matched arms, direct
search, CodeGraph retrieval, prepared context with fallback disabled/enabled and a
CodeGraph-backed on-demand control. Include tests, retries, tool definitions, cached
usage categories and aborted tasks. Its 20% median input-token and 15% median time
targets are unachieved design gates with no observed quality decline; cheap-task
regression above 10% triggers investigation. The second engine needs its own measured
incremental benefit, not an automatically inherited 20%/15% claim. Model and spend cap
must be assigned before paid trials. Reject, narrow or disable a failing capability.

Completion records use this format (plain records are not extra checklist items):

```text
UTC | phase/task ID | authorization and owner | exact source + dirty manifest
delivered paths/contracts | dependency/artifact/store versions | commands + exit codes
counts/durations/failures/skips | retained evidence paths/hashes | limitations
implementation state | validation state | integration state | release state
review decision | next exact prompt
```

Checkbox fractions measure the defined work items, not product readiness, effort or
probability of success. Existing upstream features are not completed adoption tasks.
Preparation and new implementation are counted separately; historical accepted repairs
keep their original identifiers and scoped evidence.

## Ordered implementation phases

### Phase 1 — Adoption record and supported profile

Status: Not started

Prerequisites:
This reviewed plan, preserved repair receipt and supervisor assignment naming the adoption-record writer and provisional scope; Phase 1 supplies inputs to X-01 and does not require X-01 already accepted. No backend execution required.

Goal to assign:
Freeze the CodeGraph adoption manifest and first supported product profile without changing runtime code.

Scope and ownership:
Fork maintainer owns future docs/pelagion adoption/patch records; supervisor owns cross-plan decisions and deployment identity.

Tasks:
- [ ] CG-T01-01 Record base/fork/release identities, all 21 repair-file hashes and both original/patched lock hashes in a maintained adoption manifest.
- [ ] CG-T01-02 Name engine, TypeScript/Python protocol, release and evaluation owners; settle Git search/context boundaries and unresolved shared-service requests through X-01.
- [ ] CG-T01-03 Declare initial Python/layout and Windows runtime support, source-only versus relationship admission, native/WASM profile and exact reference machine.
- [ ] CG-T01-04 Inventory dependencies/assets/notices and relevant current advisories; select a reviewed runtime candidate without installation.
- [ ] CG-T01-05 Create patch inventory entries for CG-01–05 with regression receipts and upstream disposition; preserve the old report and failed runs.
- [ ] CG-T01-06 Approve bounded baseline workspace/home/temp/network/process policy and numerical qualification budgets; record unaccepted capabilities explicitly.

Validation:
Read-only provenance comparison, schema/profile review and evidence-link checks; no feature or test execution.

Completion criteria:
Every baseline input and maintainer is identified, dependency download scope is concrete, and source-only admission is distinct from graph acceptance.

Risks and unresolved decisions:
Supervisor resolves resource ceilings and source-pin packaging choice; Hirad decides additional platform promises only if requested.

Next prompt:
> After Hirad assigns this next phase, name its writer, exact owned files, accepted prerequisite receipts and finite resource/download scope. Read TAKEOVER-TODO.md and execute only CodeGraph Phase 2, the isolated unmodified upstream baseline, using the accepted Phase 1 manifest; preserve all local repairs and failures. Completion of the preceding phase is not standing authorization to start.

### Phase 2 — Reproducible unmodified and patched baselines

Status: Not started

Prerequisites:
Accepted CG Phase 1 profile and isolated resource plan, plus final supervisor/Architect X-01 receipt; exact base and lock objects available; assigned baseline execution.

Goal to assign:
Establish comparable upstream-control and preserved-patch baseline evidence using the reviewed procedures.

Scope and ownership:
Fork maintainer/evaluator: isolated baseline copies and codegraph-evaluation evidence; no Pelagion environment or production code changes.

Tasks:
- [ ] CG-T02-01 Materialize separate clean upstream and patched snapshots with retained manifests; verify no patch file leaked into the control.
- [ ] CG-T02-02 Provision exact approved Node/npm/dependencies in temporary evaluation directories; retain install inventory and script/network log.
- [ ] CG-T02-03 Run the same declared acceptance-relevant upstream build and full Vitest legs on BOTH clean control and patched snapshots, with bounded process ownership; retain failures/skips on both rather than repairing the control.
- [ ] CG-T02-04 Replay the 183-test repair set and original corpus on the preserved patched snapshot; compare each result to its earlier receipt.
- [ ] CG-T02-05 Record cold/warm indexing/query/sync fixtures, total worker resources and output sizes as a reproducible performance baseline, without model calls.
- [ ] CG-T02-06 Classify regressions versus reproduced upstream failures versus unavailable environment; verify cleanup and preservation of original source/output.

Validation:
Actual upstream/patch logs, JUnit or equivalent counts, timing/resource data and independent source manifests. No full Pelagion suite.

Completion criteria:
A clean rerun is reproducible; failures have concrete classifications and recovery actions, and no baseline is falsely marked all green.

Risks and unresolved decisions:
Windows process cleanup, Node guard/runtime discrepancy, optional native build and missing UI/tsx tooling may block matrix legs; record them and narrow support explicitly.

Next prompt:
> After Hirad assigns this next phase, name its writer, exact owned files, accepted prerequisite receipts and finite resource/download scope. Execute only CodeGraph Phase 3: define and validate the versioned engine evidence protocol and Pelagion mapping fixtures; do not start provider/runtime implementation. Completion of the preceding phase is not standing authorization to start.

### Phase 3 — Versioned evidence and process contracts

Status: Not started

Prerequisites:
Baseline facts accepted; X-01 assigns code-context and shared-service boundaries. No dependency on completed LangGraph runtime.

Goal to assign:
Define the engine wire protocol and validate its mapping into the single backend-neutral code-context contract.

Scope and ownership:
Engine owner: src/types.ts and planned protocol/schema fixtures; code-context owner: assigned external/internal schemas and docs; supervisor registers packages only when assigned.

Tasks:
- [ ] CG-T03-01 Specify workspace/config/build/parser/resolver/generation identities, source byte hashes/encoding/ranges and complete/partial/busy/failed coverage receipts.
- [ ] CG-T03-02 Specify symbol/relationship evidence states, candidates and rule IDs; never encode unresolved bindings as empty success or numerical confidence as probability.
- [ ] CG-T03-03 Define readiness/index/sync/search/source/relationship/impact/contract-trace/compare/explain operation contracts and finite continuation bounds.
- [ ] CG-T03-04 Specify bounded framing, request IDs, capability negotiation, timeouts/cancellation/EOF and process ownership for short-lived and persistent modes.
- [ ] CG-T03-05 Agree explicit mapping into WorkspaceIdentity, SourceManifest, QueryResult, ContextPacket/Delta and OperationReceipt; preserve unsupported fields and loss.
- [ ] CG-T03-06 Create shared language-neutral conformance fixtures and TypeScript/Python validation checks; prevent manual schema drift and backend objects escaping public models.

Validation:
Valid/invalid/unknown-field/version fixtures, JSON/Python round trips, malformed/oversized framing and clean stdout; fixtures suffice only for contract acceptance.

Completion criteria:
Architect and both provider consumers accept one protocol/mapping, with explicit generation and failure semantics and no duplicated policy ledger.

Risks and unresolved decisions:
SourceManifest is a code-context domain contract, not an accepted shared Phase 9 service. Coordinator must resolve required reusable lifecycle gaps before coding.

Next prompt:
> After Hirad assigns this next phase, name its writer, exact owned files, accepted prerequisite receipts and finite resource/download scope. Execute only CodeGraph Phase 4: implement common-generation index publication and typed refresh receipts, using the accepted protocol and mutation oracle. Completion of the preceding phase is not standing authorization to start.

### Phase 4 — Consistent index generations and failure recovery

Status: Not started

Prerequisites:
CG Phase 3 evidence contract and accepted bounded index lifecycle ownership; clean/patch baseline oracle available.

Goal to assign:
Make index and delivered relationship evidence refer to a coherent captured source/configuration generation.

Scope and ownership:
Engine owner: src/index.ts, src/extraction/, src/db/, src/resolution/, src/mcp/ and focused tests; no generic Pelagion cache service.

Tasks:
- [ ] CG-T04-01 Return explicit busy/partial/failed/current statuses instead of interpreting zero sync counters as freshness.
- [ ] CG-T04-02 Record actual processed bytes and relevant configuration/exclusion/resolver identities; distinguish decoded-text hashes and observational multi-file capture.
- [ ] CG-T04-03 Publish complete generations atomically or prove an equivalent reader-isolation mechanism; preserve the last accepted generation after interrupted writes.
- [ ] CG-T04-04 Invalidate/re-resolve add/edit/delete/rename and mapping-only changes; reject/downgrade mixed graph/new-source packets at delivery.
- [ ] CG-T04-05 Exercise same-size/mtime edits, lock contention, queries during refresh, missed watcher events and crash/reopen with a clean-rebuild oracle.
- [ ] CG-T04-06 Version index migration/rebuild behavior and owned lock recovery; retain prior stores and prove user source/configuration remains unchanged.

Validation:
Real SQLite/process tests; initial tiny mapped fixture with eight mutation/concurrency schedules repeated at least three times, then retained corpus. Report coverage and time bounds.

Completion criteria:
No accepted packet mixes generations in the declared schedules; source/config drift is visible, incomplete coverage stays incomplete and refresh converges to rebuild.

Risks and unresolved decisions:
Current rendering includes relationship prose without a typed common generation. Do not upgrade its authority merely because selected snippets hash correctly.

Next prompt:
> After Hirad assigns this next phase, name its writer, exact owned files, accepted prerequisite receipts and finite resource/download scope. Execute only CodeGraph Phase 5: produce and register a verified immutable fork artifact with retained notices and provenance; do not publish without explicit authorization. Completion of the preceding phase is not standing authorization to start.

### Phase 5 — Immutable fork artifact and coordinator registration

Status: Not started

Prerequisites:
Accepted baseline/contracts/generation work and explicit commit/artifact selection; source pin includes required repairs.

Goal to assign:
Build an identifiable engine artifact and register its optional Pelagion dependency boundary.

Scope and ownership:
Fork release owner controls packaging; supervisor alone controls Pelagion root mappings/extra/lock/metadata and environment window.

Tasks:
- [ ] CG-T05-01 Select a verified fork-available immutable SHA, or an explicitly approved immutable local source/archive and artifact with full manifests for private qualification. Creating/pushing commits or publishing packages requires separate authority; a local snapshot is not a remote pin.
- [ ] CG-T05-02 Build the chosen Windows artifact with exact Node/npm/Cargo/toolchain and lock identities; include SQL/WASM and declare native/viewer presence.
- [ ] CG-T05-03 Record artifact hashes, provenance, notices, protocol/index versions and capability profile; inspect the archive contents rather than trusting package version.
- [ ] CG-T05-04 Register code-context package paths, optional engine configuration and external/internal tools schemas without creating another Python project.
- [ ] CG-T05-05 Install only in the coordinator window; verify consumed fork SHA/artifact, dependencies and package imports. Smoke-test only readiness/absence paths actually implemented at this point; operational API/CLI acceptance belongs to Phase 6.
- [ ] CG-T05-06 Rehearse rollback to a retained compatible artifact/store on owned fixtures; no registry substitution or silent incompatible index downgrade.

Validation:
Artifact content/provenance checks, installed-outside-checkout package/import registration and implemented readiness/absence smoke only; no claim of Phase 6 operational acceptance. Full release remains Phase 10.

Completion criteria:
The installed engine is traceable to the selected fork source, repairs and build inputs; uninstalled operation fails safely and release identity is unambiguous.

Risks and unresolved decisions:
The current dirty repair tree is not an immutable dependency. Namespace/signing/distribution decisions belong to Hirad/release owner, not an automatic npm publish.

Next prompt:
> After Hirad assigns this next phase, name its writer, exact owned files, accepted prerequisite receipts and finite resource/download scope. Execute only CodeGraph Phase 6: deliver bounded candidate search and independently verified source through the registered Pelagion API and thin CLI. Completion of the preceding phase is not standing authorization to start.

### Phase 6 — First useful Python search and source operation

Status: Not started

Prerequisites:
Pinned installed artifact, accepted protocol and source-only admission; public path/IO primitives available within accepted limits.

Goal to assign:
Make a real Python request find candidates and return bounded current source with exact provenance.

Scope and ownership:
Code-context owner: api.py, cli.py, _internal engine bridge, owned schemas/docs/tests; engine owner only demonstrated protocol fixes.

Tasks:
- [ ] CG-T06-01 Implement lazy doctor/capability negotiation without indexing, installing or downloading as a readiness side effect.
- [ ] CG-T06-02 Implement the minimum typed readiness/index/sync/search/source application-service endpoints in the engine, then explicit coordinator index/sync and the Python search/source bridge; validate real wire conformance without parsing explore Markdown.
- [ ] CG-T06-03 Re-read and verify actual bounded bytes/encoding/ranges before publication; expose stale, empty, partial and unsupported states separately.
- [ ] CG-T06-04 Enforce process/request/output limits and cancellation through owned descendants; preserve outputs and report unknown hard-resource guarantees.
- [ ] CG-T06-05 Provide intentional model API and thin Typer commands with safe errors, clean machine stdout and no raw source in routine logs.
- [ ] CG-T06-06 Document a reproducible first useful query, backend absence and recovery, using owned synthetic/mapped fixtures outside user demos.

Validation:
Real installed Python→engine→source requests; invalid contracts before effects; Unicode/Windows containment, EOF/timeout, unchanged output and malformed backend cases.

Completion criteria:
A new process outside the checkout can retrieve byte-verified evidence within bounds using implemented typed endpoints and a refreshed pinned artifact. This conservative sequence requires Phase 4 first; relationship authority remains separately gated.

Risks and unresolved decisions:
Current-source verification can downgrade graph claims but cannot retroactively make stale relationships correct.

Next prompt:
> After Hirad assigns this next phase, name its writer, exact owned files, accepted prerequisite receipts and finite resource/download scope. Execute only CodeGraph Phase 7: qualify supported Python relationships, public-contract tracing, impact and advisory test suggestions against held-out evidence. Completion of the preceding phase is not standing authorization to start.

### Phase 7 — Qualified relationships and engineering queries

Status: Not started

Prerequisites:
Accepted coherent generations and first useful integration; independent labelled supported-subset oracle and unchanged CG-01–05 evidence.

Goal to assign:
Expose trustworthy scoped relationship operations and engineering traces with explicit uncertainty.

Scope and ownership:
Engine resolver/graph owner and code-context policy owner, one writer per file; evaluator owns held-out labels.

Tasks:
- [ ] CG-T07-01 Extend only demonstrated supported Python gaps: re-exports/static __all__, lazy/conditional imports, namespaces and scope; unsupported dynamics retain boundaries.
- [ ] CG-T07-02 Qualify callers/callees/imports/types/paths with resolver evidence; separate confirmed static, inferred, ambiguous, external, unresolved and unsupported states.
- [ ] CG-T07-03 Trace public API→schemas/adaptors/CLI/docs/tests using actual source and explicit Pelagion ownership mappings, preserving real forbidden edges as findings.
- [ ] CG-T07-04 Return possible impact and candidate tests with reasons/coverage; never delete the original mandatory acceptance checks.
- [ ] CG-T07-05 Provide bounded generation/symbol/contract comparisons without taking over Git revision/content fact ownership.
- [ ] CG-T07-06 Run adversarial collision/shadowing/layout and held-out precision/recall; require native/WASM parity before admitting BOTH backends. An excluded backend stays disabled/unaccepted; publish denominators and abstentions.

Validation:
All retained defects remain fixed; target >=99% precision and >=95% recall only on the declared supported subset, with per-feature unresolved/error rates and task review.

Completion criteria:
Every enabled relationship family meets its named gate; unsupported language/layout claims remain disabled or explicitly advisory.

Risks and unresolved decisions:
No finite static corpus proves all runtime calls. Expanding all languages or replacing the parser is outside this initial phase.

Next prompt:
> After Hirad assigns this next phase, name its writer, exact owned files, accepted prerequisite receipts and finite resource/download scope. Execute only CodeGraph Phase 8: build structured context selection and the common delivered-evidence budget ledger, integrating the accepted secondary-provider contract without mandatory fallback. Completion of the preceding phase is not standing authorization to start.

### Phase 8 — Structured context packets and shared delivery budget

Status: Not started

Prerequisites:
Accepted source/relationship profiles; X-02 code-context contract owner; secondary protocol may be unavailable but must have a declared interface.

Goal to assign:
Prepare self-contained or acknowledged-delta task packets with exact supported-encoding budgets.

Scope and ownership:
Code-context owns packet selection/policy/ledger; engine owner factors structured retrieval behind CLI/MCP without a wholesale rewrite.

Tasks:
- [ ] CG-T08-01 Extend the Phase 6 structured service endpoints to rich task context/relationship selection, removing the remaining context adapter dependence on explore Markdown; preserve CLI/MCP compatibility and label adapter versions.
- [ ] CG-T08-02 Select relevant source/contracts/tests/docs and separately scoped instructions while preserving the original request and acceptance criteria.
- [ ] CG-T08-03 Count the final serialized packet including labels/notices with explicit supported model-to-encoding mapping; return mandatory-content budget conflicts.
- [ ] CG-T08-04 Deduplicate across CodeGraph and secondary results by canonical workspace, actual hash and range; record only emitted evidence and explicit invalidations.
- [ ] CG-T08-05 Require receiver acknowledgement for deltas; send a self-contained refresh after compaction/new session and bound calls/pages/time/bytes/tokens across requests.
- [ ] CG-T08-06 Retain direct known-file routing, disagreement/unavailable/stale outcomes and prompt-injection boundaries; search availability must never force a search.

Validation:
Unicode/long lines/tiny budgets/duplicated ranges, changed source, both provider orders, lost context and real no-search/evidence-gap request tests.

Completion criteria:
Every delivered packet fits its declared cap, can be reconstructed from acknowledged evidence and never silently drops instructions or claims billing precision.

Risks and unresolved decisions:
Tokenization cost and tool-definition overhead must be measured. An engine-only success cap does not automatically bound the full host prompt.

Next prompt:
> After Hirad assigns this next phase, name its writer, exact owned files, accepted prerequisite receipts and finite resource/download scope. Execute only CodeGraph Phase 9: connect accepted preparation to the governed developer workflow and participate in the single controlled benefit evaluation after its model/spend budget is assigned. Completion of the preceding phase is not standing authorization to start.

### Phase 9 — Developer workflow integration and benefit decision

Status: Not started

Prerequisites:
CG Phases 1–8 and LG Phases 1–7 accepted, plus LG Phase 8 pre-live preset/interface/immutable-check-plan readiness. A joint X-05 trial assignment supplies the actual interface/model and finite spend cap. Completed LG Phase 8 or X-05 is not an entry prerequisite: CG Phase 9 participates with LG Phase 8 in producing that receipt. Accepted X-05 and a separate X-06 study assignment are required before CG-T09-05, not before joint-trial entry.

Goal to assign:
Demonstrate automatic preparation helping a real coding task and correction cycle, then measure its benefit.

Scope and ownership:
Preset owner runs the loop; evaluator owns shared study; fork maintainer supplies component measurements and fixes only assigned defects.

Tasks:
- [ ] CG-T09-01 Integrate onboarding/task-context/impact/failure-diagnosis operations through public tool APIs, with run source and check-plan identities.
- [ ] CG-T09-02 Participate in and consume the single LG Phase 8 / X-05 real Codex coding-and-correction receipt after preset gates permit it; verify actual files/tests and preserve attempts/source generations without commissioning a duplicate live trial.
- [ ] CG-T09-03 Exercise no-search, missing evidence, secondary unavailable/stale/conflicting and direct source recovery without bypassing budgets.
- [ ] CG-T09-04 Provide cold/warm and short-lived/persistent measurements for admitted profiles; compare native/WASM only when both are being admitted. Report excluded profiles separately and disclose total worker memory/startup costs.
- [ ] CG-T09-05 Participate in the single matched >=20-task WF-CI-01 study, including CodeGraph-only follow-up control and failed/aborted runs.
- [ ] CG-T09-06 Record adopt/narrow/disable by task class against correctness and cost/time criteria, with no universal savings claim.

Validation:
Actual Python→engines→Codex→checks evidence plus independent accepted-outcome review; model text alone cannot pass; shared evaluation receipt counted once.

Completion criteria:
A coding task and correction loop pass, relevant benefit is demonstrated or scope is explicitly reduced, and shared evaluation is reproducible.

Risks and unresolved decisions:
Unavailable model usage remains unavailable. Unsupported Git delivery becomes a pending handoff, never an implicit mutation.

Next prompt:
> After Hirad assigns this next phase, name its writer, exact owned files, accepted prerequisite receipts and finite resource/download scope. Execute only CodeGraph Phase 10: complete the agreed component release and shared WF-CI-01 acceptance using retained integration/evaluation evidence. Completion of the preceding phase is not standing authorization to start.

### Phase 10 — Release qualification and maintained operation

Status: Not started

Prerequisites:
All enabled capabilities accepted, shared study decision recorded, final agreed scope and release authority explicit.

Goal to assign:
Finish the reproducible component release and its part of whole-program acceptance.

Scope and ownership:
Fork maintainer/release owner and supervisor; evaluator independently audits final evidence.

Tasks:
- [ ] CG-T10-01 Run the agreed full component regression, coverage and documentation/package checks with exact source/artifact identity; preserve failures.
- [ ] CG-T10-02 Run shared whole-tool integration/clean installation once with the selected runtime/provider set and accepted platform matrix.
- [ ] CG-T10-03 Complete operator/Python/agent/maintainer docs, canonical skill/discovery, examples, configuration, safe removal, upgrade and rollback.
- [ ] CG-T10-04 Verify complete shipped notices/SBOM/provenance and capability matrix; unsupported platforms/native paths stay labelled unverified.
- [ ] CG-T10-05 Rehearse owned index migration/rebuild, interrupted update rollback, process cleanup, retention and relevant advisory response.
- [ ] CG-T10-06 Publish the final source/artifact/evidence receipt and handoff; schedule owner-run upstream review without enabling unsolicited automations.

Validation:
A01–12 relevant gates, clean installed experience, full agreed scope and actual support evidence; no newly inferred acceptance from earlier focused tests.

Completion criteria:
Release reviewer can reproduce the artifact, supported workflows and recovery; all remaining exclusions and maintenance owners are explicit.

Risks and unresolved decisions:
Publication itself is a separately authorized action. New language/viewer/runtime-trace scope needs a new bounded assignment.

Next prompt:
> After Hirad assigns this next phase, name its writer, exact owned files, accepted prerequisite receipts and finite resource/download scope. Review the accepted CodeGraph release receipt and assign one named maintenance or extension item; do not start deferred features automatically. Completion of the preceding phase is not standing authorization to start.

## Open decisions and activation blockers

Before Phase 2: the maintainer/supervisor selects exact Node/native profile, isolated baseline resource limits and download policy. Private qualification may use a supervisor-approved immutable local source/artifact with full manifests; no repaired immutable commit currently exists. Remote commit/push/publication needs Hirad authority and the applicable distribution identity only for that remote action. Before relationship admission: common-generation and held-out semantics gates. Before paid measurement: evaluator supplies tasks/model/spend cap for approval. Shared lifecycle or Git ownership gaps return to the supervisor/Architect rather than being silently duplicated.

There is no unresolved product decision preventing completion of this plan. The
selected three roles are settled. Phase assignments must name a writer, exact paths,
the accepted prerequisite receipts and the selected execution/support profile.
No application code, dependencies, tests, installers, services or model calls were
run or changed as part of this planning assignment. Git branch metadata and these
planning artifacts are the only requested takeover mutations; previous work is retained.

## Preparation progress and next assignment

- [x] CG-P01 Inspect repository instructions, representative implementation, packaging, tests and ecosystem standards.
- [x] CG-P02 Record dated local/fork/upstream identity, release/advisory evidence and existing changes.
- [x] CG-P03 Create feat/pelagion-takeover from verified main while preserving all existing source bytes.
- [x] CG-P04 Produce this repository-specific plan with capability decisions, ownership and ordered acceptance.
- [x] CG-P05 Resolve architect/adviser/manager/research/Git-owner review findings and validate links, IDs, ordering and counts.

Preparation: **5/5 tasks complete; 0 remaining**.
New implementation: **0/10 phases complete; 10 remaining**;
**0/60 tasks complete; 60 remaining**. All implementation phases are unstarted.
Historical evidence, where listed, is not added to these implementation denominators.

Next exact prompt:
> I assign Phase 1 only, with you as the adoption-record writer in this repository's `TAKEOVER-TODO.md` and planned `docs/pelagion/` adoption records. Use this reviewed plan and its branch/source receipts as prerequisites; keep investigation bounded and local, with no installs, downloads, tests, runtime changes or subsequent phase execution. Read C:/Users/hemamialagha/Documents/SD/resources/codegraph/TAKEOVER-TODO.md and the parent WF-CI-01 specification. Execute only CodeGraph Phase 1: freeze the adoption manifest, patch inventory, supported profile, ownership and isolated baseline plan. Preserve feat/pelagion-takeover and all existing repairs. Do not install dependencies, run upstream tests, change runtime code, commit or push. Report evidence, decisions, exact next prompt and separate planning/implementation counts. Return remaining owner/support decisions to the supervisor for X-01 closure.

## Planning completion record

2026-09-26 — Supervisor inspected the checkout and primary sources, preserved the
existing source tree and created this root plan on `feat/pelagion-takeover`.
[Branch/source receipt](../../pelagion-assistant/reports/supervisor-takeovers/branch-setup.json) records full pre-plan hashes;
[primary-source record](../../pelagion-assistant/reports/supervisor-takeovers/primary-sources.json) records dated API observations.
The [consultation record](../../pelagion-assistant/reports/supervisor-takeovers/consultation-review.json) records Architect,
Advisor, manager, Research and Git-owner dispositions and resolved findings.
[Document validation](../../pelagion-assistant/reports/supervisor-takeovers/plan-validation.json) records the final counts,
hashes and local-link checks. Reviews approve planning only; all X-01–07 product
gates and the new implementation tasks remain unaccepted. No commit or push is implied.

The proposed move to `C:/Users/hemamialagha/Documents/SD/pelagion-plugins/codegraph`
has **not occurred**. Automatic approval review rejected relocation on 2026-09-26
because this task's direct user instructions did not include the move; direct user
confirmation is pending. The current working path above remains authoritative.
Full-content inventory and a guarded move/rollback mapping are prepared; do not
assume the proposed destination exists or rewrite historical receipts as moved.
