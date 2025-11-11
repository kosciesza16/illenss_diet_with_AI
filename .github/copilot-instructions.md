---
Rule Type: Always
---

# AI Rules for {{project-name}}

{{project-description}}

## Tech Stack

- Astro 5
- TypeScript 5
- React 18
- Tailwind 3.4

## Project Structure

When introducing changes to the project, always follow the directory structure below:

- `./src` - source code
- `./src/components` - client-side components written in Astro (static) and React (dynamic)

When modifying the directory structure, always update this section.

## Coding practices

### Guidelines for clean code

- Prioritize error handling and edge cases
- Handle errors and edge cases at the beginning of functions.
- Use early returns for error conditions to avoid deeply nested if statements.
- Place the happy path last in the function for improved readability.
- Avoid unnecessary else statements; use if-return pattern instead.
- Use guard clauses to handle preconditions and invalid states early.
- Implement proper error logging and user-friendly error messages.
- Consider using custom error types or error factories for consistent error handling.