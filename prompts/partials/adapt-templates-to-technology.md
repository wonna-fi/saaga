**Accessibility verification** — How to verify that a function/method/class is part of the public API:

- TypeScript/JavaScript: Is it `export`ed? Is it in the module's public barrel file (`index.ts`)?
- Apex/Java/C#: Is the visibility modifier `public`?
- Python: Does it follow the underscore convention (`_private` vs public)?
- Other: Determine the language's convention

**Component/module existence verification** — How to verify a component or module exists:

- React/React Native: Search for the component file and verify it exports the component
- LWC: Glob for `componentName/componentName.js`
- Other: Determine the framework's convention

**Configuration sources** — Where configuration lives:

- Environment variables, config files, constants files, metadata objects, etc.

**Data model references** — How to refer to data structures:

- TypeScript interfaces/types, database models, ORM entities, etc.
