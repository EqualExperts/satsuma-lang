---
id: rv-tmb4
status: closed
deps: []
links: []
created: 2026-08-05T15:56:27Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [ci, release]
---
# deploy-site's 'release: published' trigger can never fire

deploy-site.yml declares 'on: release: types: [published]', but that trigger has never fired once in the repo's history — every deploy-site run for every release (v0.11.0, v0.12.0, v0.13.0) is event=workflow_dispatch, manually kicked off after the fact.

Cause: release.yml creates the release with 'gh release create' authenticated as secrets.GITHUB_TOKEN. GitHub deliberately does not raise workflow-triggering events for actions taken by GITHUB_TOKEN, to prevent recursive workflow runs. So the release IS published, but no 'release: published' event reaches deploy-site.yml.

Impact: after every release the public site still advertises the PREVIOUS version until somebody remembers to dispatch the deploy by hand. site/_data/site.json drives every download link on the site (cli.njk, vscode.njk, learn.njk, footer.njk), so the window between publishing a release and manually deploying is a window where the site serves the old tag's assets. For v0.13.0 this was caught and dispatched manually; for earlier releases the same manual step happened, which is why nobody noticed the trigger was dead.

Options: (a) have release.yml dispatch deploy-site.yml directly as a final step, which keeps it automatic and removes the human step entirely; (b) use a PAT or GitHub App token for 'gh release create' so the event does fire; (c) accept it as manual and document the step in the release runbook so it is not folklore. (a) is probably right — it needs no new secret and makes the ordering explicit.

## Acceptance Criteria

- Publishing a release results in the site being deployed with no manual dispatch, OR the manual step is documented as a required step in the release process docs
- Verified against a real release, not just by reading the workflow
- The dead 'release: published' trigger is either made to work or removed, so the workflow does not claim a trigger it never receives


## Notes

**2026-08-06T14:57:11Z**

## Notes

**2026-08-06T14:58:00Z**

Cause: release.yml creates every release using GITHUB_TOKEN, and GitHub deliberately never raises a 'release: published' event for a release created by GITHUB_TOKEN (anti-recursion protection), so deploy-site.yml's on:release trigger never fires.
Fix: added an unconditional 'gh workflow run deploy-site.yml' step to release.yml's release job (with actions: write added to its permissions) so the site deploy is dispatched directly after every release, tagged or latest; removed the dead on:release trigger from deploy-site.yml since nothing in this repo publishes a release any other way; updated CI-WORKFLOWS.md's Deploy Site section and trigger-summary diagram to match (commit immediately after fba794db).
