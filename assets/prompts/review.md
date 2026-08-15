# TASK

Review branch `{{BRANCH}}` against `{{TARGET_BRANCH}}`.

Inspect:

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

Verify correctness, regression coverage, repository conventions, security, and
maintainability. Follow @.sandcastle/CODING_STANDARDS.md and repository AGENTS.md.

Make and commit corrections directly on the branch when needed. Run the
repository's documented checks. Do not close the issue.

When complete, output `<promise>COMPLETE</promise>`.
