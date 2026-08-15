# READY ISSUES

<issues-json>

!`gh issue list --state open --label ready-for-agent --limit 100 --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

</issues-json>

The list above is the sole source of work. Do not run an unfiltered issue query.

# TASK

Build a dependency graph for the listed issues. An issue is blocked when it
requires another listed issue's code or decision, or when concurrent work would
create substantial overlap. Select every currently unblocked issue.

For each selected issue, use the deterministic branch name
`sandcastle/issue-{id}`.

# OUTPUT

Always return JSON inside `<plan>` tags:

<plan>
{"issues":[{"id":"42","title":"Fix auth bug","branch":"sandcastle/issue-42"}]}
</plan>

If the list is empty, return `<plan>{"issues":[]}</plan>`.
