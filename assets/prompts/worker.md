# READY ISSUES

The following list is the sole source of work for this run:

!`gh issue list --state open --label ready-for-agent --limit 100 --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

Do not run an unfiltered issue query. If this list is empty, output
`<promise>COMPLETE</promise>` immediately.

# TASK

Pick the highest-priority issue that is not blocked by another listed issue.
Work on exactly one issue in this iteration.

1. Read the issue and relevant repository instructions.
2. Inspect the implementation and existing tests before editing.
3. Implement the smallest complete fix and add appropriate tests.
4. Run the repository's documented verification commands.
5. Commit the completed work.
6. Close the issue only after the commit and verification succeed:
   `gh issue close <ID> --comment "Completed by Sandcastle for Agent"`

If blocked, comment on the issue with the blocker and do not close it.
When finished, output `<promise>COMPLETE</promise>`.
