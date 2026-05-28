---
name: code-improve
description: Deep multi-axis code quality review combining candid-review with ambitious structural improvement. Spawns specialized sub-agents (Architect, Reviewer, Minimalist) for a complete audit with actionable fixes and optional auto-commit.
---

# Code Improvement Review

## Principles

This methodology merges three traditions:

1. **Candid-review** — structured multi-step workflow: load project standards → detect changes → categorize with severity → present actionable fixes → select → apply → auto-commit → save state. Configurable tone (harsh/constructive), config system (project/user config, decision register).

2. **Thermo-nuclear code quality** — "code judo": reframe changes so whole categories of complexity disappear. 1k-line hard boundary as presumptive blocker. Aggressive anti-spaghetti: flag ad-hoc conditionals bolted onto unrelated flows. Clear approval bar. Output prioritization: structural > simplification > spaghetti > boundary > file size.

3. **Agency-agents** — three specialized lenses reviewing in parallel: Code Reviewer (correctness/security/maintainability), Software Architect (structure/boundaries/trade-offs), Minimal Change Engineer (diff discipline/scope control). Each has a distinct identity and critical rules.

Combined: you get the rigor of a structured review pipeline WITH the ambition to delete complexity, WITH specialized agent lenses, all in one coordinated workflow.

---

## Workflow

### Phase 0: Scope Detection

Identify what to review:

```bash
# Check for staged changes first
git diff --cached --stat

# Then unstaged changes
git diff --stat

# If on a branch, compare to merge target
# Try each in order: develop, main, stable, master
git diff <branch>...HEAD --stat 2>/dev/null
```

**Decision rules:**
- Staged changes exist → review `git diff --cached`
- Unstaged changes exist → review `git diff`
- Branch differs from merge target → review `git diff <branch>...HEAD`
- Specific path given → focus there, ignore other changes
- Nothing detected → inform user

**File exclusions** (from CLI `--exclude` or config): skip generated files, minified, vendor, node_modules.

### Phase 1: Load Standards & Config

#### 1a. Project Standards
Check for Technical.md in project root, `.candid/Technical.md`, or `.github/copilot-instructions.md`. Use any found as the quality baseline — flag violations against these.

#### 1b. Tone Preference
Precedence: CLI flags (`--harsh` / `--constructive`) > project config > user config > prompt user.

- **Harsh**: Direct, serious, demanding. "This pushes the file past 1k lines. Can we decompose first?" "This works, but it makes the surrounding code more spaghetti."
- **Constructive**: Care Personally + Challenge Directly. Explains *why* and offers multiple approaches.

#### 1c. Decision Register (Optional)
If `registerEnabled` from config (`.candid/config.json` `decisionRegister`), load `review-decision-register.md`. During review:
- Before raising a question, check if the register already has an answer
- Apply prior decisions automatically and mark as "Previously Decided"
- Record new questions from "Clarification Needed" findings

#### 1d. Config Flags
Check for `focus`, `autoCommit`, `mergeTargetBranches`, `exclude` in project config (`.candid/config.json`) and user config (`~/.candid/config.json`), with CLI flags taking highest precedence.

### Phase 2: Gather Context

Before reviewing, understand the broader picture:

1. **Read changed files in full** — not just the diff, the whole file
2. **Trace imports/exports** — what depends on this? what does this depend on?
3. **Check tests** — `*.test.*`, `*.spec.*` files for coverage
4. **Recent history** — `git log -3 --oneline -- <files>` for commit context
5. **Architecture probe** — if a file crosses 1k lines or touches multiple modules, use Contextia to understand module boundaries

### Phase 3: Dispatch Sub-Agents (Parallel)

For any review of ≥3 files or spanning multiple domains, dispatch the three agency-agents as sub-agents **in parallel**. Each receives the same scope but reviews from its own lens.

Each sub-agent returns structured findings. Merge them into a single prioritized report in Phase 4.

---

## The Three Review Lenses

### Lens 1: Code Reviewer 👁️

**Source:** `agency-agents/engineering/engineering-code-reviewer.md` (loaded into sub-agent context)

Reviews code like a mentor, not a gatekeeper. Every comment teaches something.

**Focus areas:**
- 🔴 **Correctness** — Does it do what it's supposed to? Edge cases? Error paths?
- 🔴 **Security** — Injection, XSS, auth bypass, data leaks
- 🟡 **Maintainability** — Will someone understand this in 6 months? Naming? Structure?
- 🟡 **Performance** — N+1 queries, bottlenecks, unnecessary allocations
- 🟡 **Testing** — Are the important paths tested?

**Priority markers:**
- 🔴 Blocker — Must fix (security vuln, data loss, race condition, broken API contract)
- 🟡 Suggestion — Should fix (missing validation, unclear naming, missed tests, perf issues)
- 💭 Nit — Nice to have (style, minor naming, docs)

**Output format:**
```
[icon] **Category: Title**
File: path/to/file.ts:42
Confidence: Safe ✓ | Verify ⚡ | Careful ⚠️
Problem: What's wrong and why it matters
Fix: (concrete code snippet)
```

### Lens 2: Software Architect 🏛️

**Source:** `agency-agents/engineering/engineering-software-architect.md` (loaded into sub-agent context)

Designs systems that survive the team that built them. Every decision has a trade-off — name it.

**Focus areas:**

**1. Architecture Judo (from thermo-nuclear)**
This is the most aggressive lens. For every meaningful change, ask:
- Is there a "code judo" move that would make this dramatically simpler?
- Can this change be reframed so fewer concepts, branches, or helper layers are needed?
- Does this improve or worsen the local architecture?
- Is this abstraction earning its keep, or is it just a wrapper?

**2. Domain Boundaries**
- Bounded contexts: is logic in the right module/service?
- Coupling: did this change make a previously cohesive module more coupled?
- Dependency direction: are dependencies flowing the right way? Any circular dependencies?

**3. Technical Debt & Growth**
- Did the change add branching complexity where a better abstraction should exist?
- Did a previously cohesive module become more stateful or harder to scan?
- Are there repeated conditionals that signal a missing model or missing helper?

**4. 1k-Line Gate (from thermo-nuclear)**
If the diff pushes a file from under 1k lines to over 1k lines, flag as a presumptive blocker. Prefer extracting helpers, subcomponents, or modules. Only waive with strong structural justification and demonstrably clear organization.

**5. ADR-Worthy Decisions**
When a finding meets all three criteria:
1. Hard to reverse (costly to change later)
2. Surprising without context (future reader will wonder "why?")
3. Result of a real trade-off (alternatives existed, one was chosen for specific reasons)

→ Flag as a candidate ADR.

**6. Trade-off Analysis**
For architectural findings, always name what's being gained AND what's being given up. Prefer decisions that are reversible over ones that are "optimal."

**7. Anti-Spaghetti Patrol (from thermo-nuclear)**
Be highly suspicious of:
- New ad-hoc conditionals inserted into unrelated flows
- Scattered special cases
- One-off branches in unrelated code
- Feature logic leaking into shared paths
- Implementation details leaking through APIs

When found, prefer pushing the logic into a dedicated abstraction, state machine, policy object, or separate module.

**Output format:**
```
📐 **[Category]: Title**
File: path/to/file.ts:42
Impact: Why it matters structurally
Current: What the code does now
Better: Recommended restructuring approach
Trade-off: What you gain / what you give up
ADR: Yes/No — if yes, proposed ADR title
```

### Lens 3: Minimal Change Engineer 🪡

**Source:** `agency-agents/engineering/engineering-minimal-change-engineer.md` (loaded into sub-agent context)

The smallest diff that solves the problem — every extra line is a liability.

**Focus areas:**

**1. Scope Audit**
For every changed line, ask: "Does the task require this exact line?" If no, flag it as scope creep.

Default requirement: every line in the diff must be justifiable as "this line exists because the task explicitly requires it."

**2. Refuse Premature Abstraction**
- Three similar lines beats a premature helper. Wait until the fourth occurrence.
- Don't generalize until the third use case.
- Don't add config flags for hypothetical future needs.

**3. Resist Defensive Coding**
- No error handling for impossible cases
- No defensive code for things guaranteed by the framework
- Validate only at system boundaries (user input, external APIs)

**4. No "While I'm Here" Changes**
- A bug fix PR contains only the bug fix
- Improvements and refactors get their own PR
- Don't rewrite working code in a "cleaner" style
- Don't add type annotations, docstrings, or comments to code you didn't change

**5. Surface, Don't Smuggle**
When something is genuinely worth fixing but outside scope → note it as a follow-up, not a sneak edit. File a follow-up issue.

**6. Scope Check Template**
For any diff > 30 lines, run through this mental checklist:

```
Task as stated: [paste the exact task]
Files touched: [list] — each justified?
Lines I'm tempted to add but won't: [follow-ups, not sneak edits]
Hypothetical scenarios NOT defended against: [list]
Abstractions considered and rejected: [helper count < 4]
Diff size: [X added, Y removed]
Could it be smaller?: [yes/no — if yes, make it smaller]
```

**Output format:**
```
🪡 **[Scope Issue]: Title**
File: path/to/file.ts:42
Issue: The scope problem (e.g., "this line adds a feature not in the task")
Why it matters: Every extra line is future liability — debug cost, refactor cost, reading cost
Recommendation: Remove it, or open a follow-up issue
Follow-up: [issue description if worth doing later]
```

### Optional Lens 4: Security Engineer 🔒 (dispatching when security-sensitive code changes)
**Source:** `agency-agents/engineering/engineering-security-engineer.md`

When the diff touches authentication, authorization, input handling, data storage, or external APIs, dispatch this 4th agent. Focus: OWASP Top 10, CWE Top 25, adversarial thinking, threat modeling. Each finding includes severity rating (CVSS), proof of exploitability, and concrete remediation.

---

## Phase 4: Compile & Prioritize Findings

Merge sub-agent outputs into a single prioritized report. Group the output in this order:

### Priority Order (from thermo-nuclear + candid-review merged)

| Priority | Group | Icon | Source |
|----------|-------|------|--------|
| 1 | Structural code-quality regressions | 🔴 | Architect + Reviewer |
| 2 | Security vulnerabilities | 🔒 | Reviewer + Security Engineer |
| 3 | Missed code-judo simplification | 🥋 | Architect (thermo-nuclear) |
| 4 | Spaghetti / branching complexity | 🧶 | Architect |
| 5 | Boundary / abstraction / type problems | 📐 | Architect |
| 6 | File-size violations (1k-line gate) | 📏 | Architect |
| 7 | Correctness / edge-case gaps | 🔥 | Reviewer |
| 8 | Performance issues | ⚡ | Reviewer |
| 9 | Scope creep / unnecessary changes | 🪡 | Minimalist |
| 10 | Modularity & abstraction issues | 💭 | Architect + Reviewer |
| 11 | Standards violations (Technical.md) | 📜 | Reviewer |
| 12 | Legibility & maintainability concerns | 📋 | Reviewer |
| 13 | ADR-worthy decisions | 📄 | Architect |
| 14 | Nits / minor improvements | 💭 | Reviewer |
| 15 | What's good / praise | ✅ | Reviewer |

**Critical rule**: Do not flood the output with low-value nits if there are larger structural issues. Prefer a smaller number of high-conviction findings over a long list of cosmetic notes. If ≥3 structural/spaghetti/simplification findings exist, keep nits to 0.

### Finding Format

Each finding uses this structure:

```markdown
### [Icon] [Title]
**File:** path/to/file.ts:42
**Confidence:** Safe ✓ | Verify ⚡ | Careful ⚠️
**From:** Architect | Reviewer | Minimalist | Combination
**Problem:** Clear description of what's wrong and why it matters
**Impact:** Production, maintainability, performance, or security impact
**Fix:**
```[language]
// Concrete code showing the fix
```
**Follow-up idea (if scope creep):** [description for tracking separately]
```

### Approval Bar (from thermo-nuclear)

Do not approve merely because behavior seems correct. The bar for approval:

- No clear structural regression
- No obvious missed opportunity to make the implementation dramatically simpler when such a path is visible
- No unjustified file-size explosion (1k+)
- No obvious spaghetti-growth from special-case branching
- No obviously hacky or magical abstraction
- No unnecessary wrapper/cast/optionality churn
- No clear architecture-boundary leak
- No missed opportunity for an obvious decomposition
- No scope creep (unnecessary changes beyond task scope)

Treat these as presumptive blockers unless the author can justify them clearly.

---

## Phase 5: Fix Selection

After presenting findings, offer a multi-select prompt for which fixes to apply:

**Bulk options:**
1. Apply all fixes
2. Apply Critical + Major only (🔴 🥋 🔒 🔥 ⚡)
3. Review each fix individually
4. None (track as todos)

### Clarification Needed (from candid-review, when register is enabled)

For issues where the correct fix depends on information you cannot determine from the code alone:
- Business intent is ambiguous
- Design tradeoffs need author input
- Code appears to contradict Technical.md but might be intentional

Before raising a question, check the decision register for an existing answer. If found, apply the prior decision and mark as "Previously Decided."

---

## Phase 6: Apply Fixes or Create Todos

### If fixes selected:
1. Create a todo list of all selected fixes (TodoWrite, all `pending`)
2. Apply each fix sequentially using Edit tool
3. Mark each as `completed` when done
4. Track modified files in `modifiedFiles` set
5. After all fixes applied, summarize changes

### If no fixes selected:
Create todos for ALL issues found, marked `pending`, using TodoWrite.

---

## Phase 7: Auto-Commit (Optional)

If `--auto-commit` is enabled AND fixes were applied:
1. Verify changes exist with `git diff --stat`
2. Stage only the modified files (from `modifiedFiles`)
3. Generate commit message with fix list (first 10, then "... and N more")
4. Create commit using `git commit`
5. If commit fails, fixes are preserved but uncommitted

---

## Phase 8: Save Review State

1. Create `.candid/` directory if needed
2. Save review state JSON to `.candid/last-review.json` (timestamp, commit, branch, all issues with stable IDs)
3. If decision register is enabled, save updated register

---

## Phase 9: Re-Review Mode (if `--re-review`)

Compare against previous review state (`.candid/last-review.json`):
- ✅ Fixed: issues from previous review now gone
- 🔄 Still Present: issues still there (potentially at different line numbers)
- 🆕 New: issues introduced since last review

Present comparison header and grouped findings.

---

## Tone Reference

### Direct / Serious / Demanding (default)

Use phrases like:
- "This pushes the file past 1k lines. Can we decompose this first?"
- "This adds another special-case branch into an already busy flow. Can we move this behind its own abstraction?"
- "This works, but it makes the surrounding code more spaghetti. Let's keep the behavior and restructure the implementation."
- "This feels like feature logic leaking into a shared path. Can we isolate it?"
- "This abstraction seems unnecessary. Can we just keep the direct flow?"
- "Why does this need a cast/optional here? Can we make the boundary more explicit instead?"
- "This looks like a bespoke helper for something we already have elsewhere. Can we reuse the canonical one?"
- "I think there's a code-judo move here that makes this much simpler. Can we reframe this so these branches disappear?"
- "This refactor moves complexity around but doesn't really delete it. Is there a way to make the model itself simpler?"
- "This line isn't required by the task. Why is it here?"

### Constructive / Explanatory (when `--constructive`)

Same rigor, but explains *why* more thoroughly, acknowledges difficulty, offers multiple approaches, starts with "I see what you were trying to do here."

---

## Config Reference

Config files (precedence: CLI > project config > user config):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mergeTargetBranches` | string[] | ["main","stable","master"] | Branches to diff against |
| `focus` | string | null | Limit to: security, performance, architecture, edge-case |
| `exclude` | string[] | [] | Glob patterns to exclude |
| `autoCommit` | boolean | false | Auto-commit after fix application |
| `decisionRegister` | object | {enabled:false} | Decision register config |

Config file location:
- Project: `.candid/config.json`
- User: `~/.candid/config.json`