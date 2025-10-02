# Contributing Code Samples

This document describes how to add new code samples to the portfolio site. The system automatically discovers and displays any projects you add to this directory.

## Quick Start

1. Create a new folder in `src/code-samples/` with a kebab-case name (e.g., `my-project`)
2. Add your code files
3. Create a `README.md` with project documentation
4. (Optional) Add a `metadata.json` for custom display options
5. Done! The project will automatically appear on the site

## Directory Structure

```
src/code-samples/
├── {project-id}/              # Kebab-case ID (e.g., overhub-api)
│   ├── README.md             # Project documentation (required)
│   ├── metadata.json         # Display metadata (optional)
│   └── {source-files}        # Any .js, .ts, .jsx, .tsx, .vue, .css, .md files
│       ├── src/
│       ├── lib/
│       ├── __tests__/
│       └── ...
```

## Naming Convention

**Project ID**: Use kebab-case for the directory name. This becomes the project identifier.

Examples:
- `overhub-api` ✅
- `portable-cart` ✅
- `admin` ✅
- `MyProject` ❌ (use `my-project` instead)
- `my_project` ❌ (use `my-project` instead)

## Required Files

### README.md (Required)

Every project must have a `README.md` file that describes:
- What the project does
- Technologies used
- Key features or patterns demonstrated
- Any special setup or context

**Example:**
```markdown
# My Amazing Project

A React application demonstrating advanced state management patterns.

## Technologies
- React 18
- TypeScript
- Redux Toolkit

## Key Features
- Complex state orchestration
- Performance optimization
- Custom hooks pattern
```

## Optional Files

### metadata.json (Optional)

Control how your project appears on the site. If omitted, sensible defaults are used.

**Schema:**
```json
{
  "id": "project-id",
  "title": "Display Title",
  "summary": "One-line summary for navigation",
  "featured": ["path/to/file1.js", "path/to/file2.js"],
  "annotations": {
    "path/to/file.js": {
      "12-25": "Explanation for lines 12-25",
      "45": "Explanation for line 45"
    }
  }
}
```

**Fields:**
- `id` (string): Must match directory name
- `title` (string): Display name (defaults to capitalized directory name)
- `summary` (string): Brief description (defaults to empty)
- `featured` (array): File paths to highlight (defaults to first 3 code files)
- `annotations` (object): Line-level annotations (future feature, currently unused)

**Example metadata.json:**
```json
{
  "id": "my-project",
  "title": "My Amazing Project",
  "summary": "Advanced React state management",
  "featured": [
    "src/store/index.ts",
    "src/hooks/useData.ts",
    "src/components/Dashboard.tsx"
  ]
}
```

## Supported File Types

The code browser automatically displays these file types:
- JavaScript: `.js`, `.jsx`
- TypeScript: `.ts`, `.tsx`
- Vue: `.vue`
- Styles: `.css`, `.scss`
- Data: `.json`
- Documentation: `.md`

Other file types are ignored (e.g., `.gitignore`, `.env`, binary files).

## File Organization Best Practices

**Recommended structure:**
```
your-project/
├── README.md
├── metadata.json (optional)
├── src/
│   ├── components/
│   ├── services/
│   ├── lib/
│   └── utils/
├── __tests__/
└── ...
```

**Tips:**
- Organize code files logically (by feature, layer, or type)
- Keep README.md at the root level
- Include tests to demonstrate testing practices
- Use clear, descriptive file names

## Automatic Discovery Features

The system automatically:
- **Scans** your project directory recursively
- **Builds** a file tree for navigation
- **Detects** file types and applies syntax highlighting
- **Sorts** folders and files alphabetically
- **Filters** out non-code files (node_modules, .git, etc.)
- **Displays** the first featured file by default

## What Gets Displayed

### On the Main Page
- Project title from `metadata.json` or directory name
- Summary from `metadata.json`
- Custom metrics, stack, highlights from `codeSamples.ts` (legacy system)

### In the Code Browser
- File tree navigation (folders and files)
- Syntax-highlighted code viewer
- File names and extensions
- Copy-to-clipboard functionality
- Responsive layout (mobile-friendly)

## Integration with Existing System

The code browser integrates with the existing `codeSamples.ts` data:

1. Update `src/data/codeSamples.ts` to add display metadata (title, summary, metrics, etc.)
2. Add your project folder to `src/code-samples/`
3. The code browser will automatically appear in the matching sample card

**Note:** The `id` field in `codeSamples.ts` must match your directory name.

## Examples

### Minimal Example

```
src/code-samples/
└── simple-app/
    ├── README.md
    └── index.js
```

This is all you need! The system will:
- Display "Simple App" as the title
- Show `index.js` in the code viewer
- Generate a basic file tree

### Full-Featured Example

```
src/code-samples/
└── complex-app/
    ├── README.md
    ├── metadata.json
    ├── src/
    │   ├── components/
    │   │   ├── Header.tsx
    │   │   └── Footer.tsx
    │   ├── services/
    │   │   └── api.ts
    │   └── utils/
    │       └── helpers.ts
    └── __tests__/
        └── api.test.ts
```

With `metadata.json`:
```json
{
  "id": "complex-app",
  "title": "Complex Application",
  "summary": "Full-stack TypeScript app",
  "featured": [
    "src/services/api.ts",
    "src/components/Header.tsx",
    "__tests__/api.test.ts"
  ]
}
```

## Testing Your Changes

After adding a new project:

1. **Start dev server**: `npm run dev`
2. **Navigate to**: `http://localhost:4321/code-samples`
3. **Verify**:
   - Your project appears in the list
   - File tree loads correctly
   - Code displays with syntax highlighting
   - Files are clickable and load properly
   - Mobile layout works (resize browser)

## Troubleshooting

**Project doesn't appear:**
- Check directory name uses kebab-case
- Ensure README.md exists
- Verify no syntax errors in metadata.json

**Files not showing:**
- Check file extensions are supported
- Look for hidden files (starting with `.`)
- Ensure files aren't in excluded directories (node_modules, .git)

**Code not highlighting:**
- Verify file extension is recognized
- Check for syntax errors in the code file

**Styles look broken:**
- Clear browser cache and reload
- Check browser console for errors
- Verify all components are imported correctly

## Migration from Old System

If you have existing code samples referenced in `codeSamples.ts`:

1. Create a matching directory in `src/code-samples/`
2. Move your code files into that directory
3. Create a README.md summarizing the project
4. The code browser will automatically integrate

You don't need to remove entries from `codeSamples.ts` - both systems work together.

## Future Enhancements

Planned features for the code browser:
- Line-level annotations and tooltips
- Search within files
- Syntax highlighting themes
- Diff views for showing changes
- Direct GitHub links

## Questions?

If you encounter issues or have suggestions for improving the code samples system, please:
1. Check this documentation first
2. Review existing samples for examples
3. Test in dev mode before committing
4. Document any custom patterns you create

---

**Remember:** The system is designed to be zero-maintenance. Just add a folder with code, and it works!
