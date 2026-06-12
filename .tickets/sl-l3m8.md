---
id: sl-l3m8
status: closed
deps: []
links: []
created: 2026-06-12T09:31:06Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [cli]
---
# where-used: transforms and fragments defined inside a namespace report no references

where-used resolves the definition (echoing the qualified name, e.g. crm::tidy) but finds zero references for transforms and fragments declared inside a namespace block, even when they are clearly used in the same file. Schemas in namespaces work correctly (sources/targets, ref metadata, and imports are all found). Likely cause: spread/invocation references are indexed under the bare name while the lookup compares against the namespace-qualified name.

Repro (both report 'No references to crm::tidy found', exit 1):

namespace crm {
  schema a { x STRING }
  schema b { x STRING }
  transform tidy { trim | lowercase }
  mapping m1 {
    source { a }
    target { b }
    x -> x { ...tidy }   // bare 'tidy' invocation also missed
  }
}

Fragment case: a fragment in a namespace spread via ...audit_fields into two schemas also reports no references. The same file with the namespace block removed works for all forms.

## Acceptance Criteria

where-used <transform> finds bare invocations and ...spreads of a transform defined in a namespace, both from inside and outside that namespace; where-used <fragment> finds ...spreads of a namespaced fragment; tests cover bare/spread x namespaced/unnamespaced; assess whether the resolution lives in satsuma-core and fix it there so the LSP find-references gets the same fix


## Notes

**2026-06-12T11:54:25Z**

Cause: where-used resolved the queried definition through the namespace-aware index (key e.g. crm::tidy) but compared CST reference text raw, so bare invocations/spreads authored inside the namespace never matched the qualified key.
Fix: Threaded the enclosing namespace through findTransformRefs/findFragmentSpreads and resolved each reference via core's resolveScopedEntityRef (same binding rule as the LSP's sl-p256 fix); LSP unaffected since viz-backend already re-resolves refs by authoring namespace. Subprocess tests now cover bare/spread x namespaced/unnamespaced plus shadowing (commit 86db538)
