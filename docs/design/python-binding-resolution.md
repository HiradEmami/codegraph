# Python import identity and package mappings

The Python resolver uses the import's original module, exported name, local
alias and lexical scope before considering a same-named graph symbol. Import
failure is a stop: an unavailable or ambiguous import does not become a call
to an unrelated definition elsewhere in the repository.

The binding index reads AST-extracted import statements and declaration
positions. It supports multiline named imports, function-local imports,
private names, aliases, module members, nested function closures and named
re-exports. Methods do not inherit bare names from their class namespace.
Constructor calls keep the imported class's actual identity. Dotted calls
such as `pkg.engine.run()` retain their full receiver during extraction.

Parameters, local declarations, simple assignments, unpacking, loop targets,
comprehensions and detected scope redirections prevent imported names from
leaking into a shadowing scope. Conditional/conflicting bindings, import
cycles, wildcard imports and detected `global`/`nonlocal` redirections are
conservative unresolved cases. Local receivers constructed from a named class
and annotated receivers retain the existing validated method-inference path.
This is static analysis, not a complete Python execution or data-flow model:
dynamic imports, module `__getattr__`, monkey-patching, arbitrary value flow,
all pattern-matching/destructuring forms and runtime path changes are not
claimed as resolved. Confidence describes evidence for a supported binding,
not a probability that arbitrary Python will execute that path.

## Supported configuration

The project root's `pyproject.toml` may contain an explicit string table:

```toml
[tool.setuptools.package-dir]
"" = "src"
"pkg" = "src/custom-layout"
"pkg.child" = "another/place"
```

The longest matching canonical package prefix wins. Mapped physical paths do
not acquire guessed alternate module names. Default source roots and ordinary
package trees are indexed when no explicit mapping owns their canonical name.
Multiple files with the same module identity remain ambiguous. Relative
imports follow canonical package ancestry, including relocated child packages.
A checkout that is itself a package root supports one-dot sibling imports.

Supported table entries use quoted or simple bare keys and single-line quoted
string values, with ordinary comments. Inline tables, complex/dynamic setup
configuration, `setup.py`, `setup.cfg`, discovery directives, multiline strings
and general TOML syntax outside this narrow table contract are not interpreted.
No project code or build script is executed. Unsupported/malformed declared
mapping syntax, duplicate entries and escaping paths fail closed. Unrelated
tools' `package-dir` keys are ignored. Real paths are checked as well as lexical
paths: mapped directories and Python module files escaping through symlinks
or Windows junctions cannot supply binding targets.

The full-index result includes `python_package_map_unsupported` warnings in
`errors`; incremental sync exposes the same diagnostics in optional `errors`.
The warning does not mean Python parsing failed: declarations may be indexed
while the affected imported relationships remain unresolved.

## Refresh and verification

Full indexing records a SHA-256 of the configuration bytes. Sync compares it
even when only `pyproject.toml` changed. A changed configuration forces Python
files through storage and reference resolution, replacing their prior outgoing
edges; `pythonFilesReindexed` reports that work separately from file edits.
Unchanged configuration avoids this work. A failed refresh does not advance the
configuration stamp. Existing indexes should be fully rebuilt after this
extractor/resolver upgrade, since old import declarations and dotted call refs
do not contain the new evidence.

Regression coverage is in `__tests__/python-binding-resolution.test.ts` and
`__tests__/python-module-map.test.ts`. It includes decoy-name collisions,
relative/absolute/mapped layouts, original-name aliases, scope shadowing,
re-exports, invalid configuration, ambiguity, real Windows junction containment,
and configuration-only refresh without changed Python bytes. Real-corpus repair
evidence is maintained separately from the original assessment snapshot.
