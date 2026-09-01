# Web style ownership

`index.css` is the only runtime style entry. Import order is deliberate and is verified by `style-architecture.test.ts`.

- `tokens.css`: semantic colors and theme values.
- `base.css`: reset, application shell, safe areas and cross-feature primitives.
- `foundation.css`: frozen compatibility foundation migrated from the former override file; do not append version sections here.
- `settings.css`, `workbench.css`, `tasks-stats.css`, `setup.css`, `world.css`: feature-owned rules.
- `theme.css`: compatibility rules for existing dark-theme selectors; new components should consume tokens instead.
- `building-memory.css`: building-memory panel only.

New work goes to the owning feature file, uses semantic class names, and must not introduce version-number selectors. The compatibility files are reduced when a touched component is migrated; they are not an override dumping ground.
