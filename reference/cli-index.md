
## Satsuma CLI — Agent Tooling

> **Include this section only when the agent has access to the `satsuma` CLI.**
> Run `satsuma agent-reference` to print this entire document.

The `satsuma` CLI is a deterministic structural extraction tool. It extracts facts from parse trees and delivers NL content verbatim. **It does not interpret natural language — that is your job.** The CLI is the toolkit. You are the runtime.

Every command produces 100% correct results from structural analysis. There are no `impact`, `audit`, or `inventory` commands — those are workflows you compose from primitives, applying your own reasoning to the NL content the CLI surfaces. `coverage` *is* a command, because which fields an arrow references is a fact about the parse tree and the rollup across mappings is arithmetic; judging whether a gap matters is still yours.

**Self-discovery:** Every command supports `--help` with its full flag list, JSON output shape, and examples. Run `satsuma <command> --help` to inspect any command without consulting external docs.

### Command reference

```bash
# Workspace extractors — retrieve whole blocks
satsuma summary platform.stm                # overview — schemas, mappings, metrics, counts
satsuma schema hub_customer                  # full schema definition
satsuma mapping "sfdc to hub_customer"        # full mapping with all arrows
satsuma metric monthly_revenue               # full metric definition
satsuma lineage --from loyalty_sfdc          # schema-level graph traversal
satsuma where-used hub_product               # all references to a name
satsuma find --tag pii                       # fields carrying a metadata tag
satsuma warnings                             # all //! and //? comments
satsuma context "customer mapping"           # keyword-ranked block extraction (heuristic)

# Field-level lineage — trace a single field upstream and downstream
satsuma field-lineage loyalty_sfdc.LoyaltyTier --json     # full upstream + downstream chain
satsuma field-lineage loyalty_sfdc.LoyaltyTier --upstream # only upstream (what feeds this field)
satsuma field-lineage loyalty_sfdc.LoyaltyTier --downstream # only downstream (where this field flows)

# Structural primitives — slice below block level
satsuma arrows loyalty_sfdc.LoyaltyTier      # immediate arrows involving this field + classification
satsuma nl "demographics to mart"            # NL content in a mapping
satsuma nl mart_customer_360.email            # NL content on a specific field
satsuma nl all platform.stm                   # all NL across the entry-file workspace
satsuma meta loyalty_sfdc.Email              # metadata entries (tags, type, constraints)
satsuma fields sat_customer_demographics     # field list with types
satsuma fields mart_customer_360 --unmapped-by 'demographics to mart'  # one schema vs one mapping
satsuma match-fields --source loyalty_sfdc --target sat_customer_demographics  # name comparison
satsuma nl-refs platform.stm --json          # extract @ref references from NL text

# Coverage — which declared fields is nothing mapping yet?
satsuma coverage platform.stm --json         # every mapping, per-mapping AND aggregate figures
satsuma coverage platform.stm --uncovered    # the review queue: only the gaps
satsuma coverage platform.stm --schema mart_customer_360 --json   # one schema, every mapping
satsuma coverage platform.stm --role target  # only what gets written
satsuma coverage platform.stm --fail-under 90 # CI gate: exit 3 below the threshold

# Workspace graph — full topology in one call
satsuma graph platform.stm --json            # complete semantic graph (nodes, edges, field-level flow)
satsuma graph platform.stm --json --schema-only   # topology only (no field-level edges)
satsuma graph platform.stm --json --namespace crm # filter to a namespace
satsuma graph platform.stm --json --no-nl         # strip NL text for smaller payload
satsuma graph platform.stm --compact              # flat schema-level adjacency list

# Formatting
satsuma fmt file.stm                         # format a single file
satsuma fmt --check pipeline.stm             # CI mode — exit 1 if any file would change
satsuma fmt --diff file.stm                  # print diff without writing
cat file.stm | satsuma fmt --stdin           # pipe: read stdin, write stdout

# Structural analysis
satsuma validate pipeline.stm               # parse errors + semantic reference checks
satsuma lint pipeline.stm                   # policy/convention checks (duplicates, NL refs)
satsuma lint --fix pipeline.stm             # apply safe deterministic fixes
satsuma lint --json pipeline.stm            # structured lint diagnostics
satsuma diff old-platform.stm new-platform.stm # structural comparison of two snapshots
```
