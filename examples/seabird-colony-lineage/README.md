# seabird-colony-lineage

Exercises deeply nested field lineage and coverage across file and namespace
boundaries. A field-tablet survey is flattened into science observations, while
preserving nested bird-ring records, then flattened again into an analytics fact.

## Key features demonstrated

- A platform entry point importing schemas from three files and namespaces
- A two-hop field lineage chain across `survey`, `science`, and `mart`
- `flatten` over nested sightings, with an `each` block preserving nested rings
- Leaf-only hierarchical coverage with one deliberate source gap

## Entry point and expected results

Use `platform.stm` for platform-wide traversal:

```console
$ satsuma field-lineage survey::colony_survey.transects.sightings.species_code platform.stm --downstream
survey::colony_survey.transects.sightings.species_code — 2 lineage connections

  downstream (2):
    science::colony_observations.observations.species  via science::extract observations  [none]
    mart::species_fact.species_code  via mart::publish species fact  [none]
```

The first mapping covers 6/7 source leaves (85%) and all 5 target leaves. The
second covers 3/5 source leaves (60%) and all 3 target leaves. The only source
gap in the survey is `transects.transect_ref`; ring fields intentionally stop at
the science observation schema.
