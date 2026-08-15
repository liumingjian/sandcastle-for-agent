# TASK

Merge these branches into the current branch:

{{BRANCHES}}

For each branch, run `git merge <branch> --no-edit`, resolve conflicts carefully,
and run the repository's documented verification commands. After all successful
merges, commit any required conflict resolutions.

# CLOSE ISSUES

Close only issues whose branches were successfully merged:

{{ISSUES}}

Use `gh issue close <ID> --comment "Completed by Sandcastle for Agent"`.

When complete, output `<promise>COMPLETE</promise>`.
